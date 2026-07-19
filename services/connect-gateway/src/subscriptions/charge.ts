import type { Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { createQuote } from '../quotes.js';
import { getSimulator } from '../testmode/simulator.js';
import { emitSubscriptionCharged, emitSubscriptionFailed } from '../webhooks/events.js';
import { getChargeIntervalMs } from './subscriptions.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_MS = 5000;
const RETRY_BACKOFF_CAP_MS = 3_600_000;

export function getMaxAttempts(): number {
  const configured = process.env.SUBSCRIPTION_MAX_ATTEMPTS;
  if (!configured) {
    return DEFAULT_MAX_ATTEMPTS;
  }

  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_ATTEMPTS;
  }

  return parsed;
}

export function computeRetryBackoffMs(attempt: number): number {
  return Math.min(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1), RETRY_BACKOFF_CAP_MS);
}

export interface ChargeResult {
  subscriptionId: string;
  status: 'succeeded' | 'failed';
  escrowId?: string;
  subscriptionStatus: SubscriptionStatus;
}

export async function chargeSubscription(subscriptionId: string): Promise<ChargeResult> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub || sub.status !== 'active') {
    return {
      subscriptionId,
      status: 'failed',
      subscriptionStatus: sub?.status ?? 'canceled',
    };
  }

  const now = new Date();

  // Simulated charge failure (test-mode directive).
  if (sub.failNextCharge) {
    return failCharge(sub.id, sub.apiKeyId, sub.attemptCount, 'insufficient_funds');
  }

  const apiKey = await prisma.apiKey.findUnique({ where: { id: sub.apiKeyId } });
  const spreadBps = apiKey?.quoteSpreadBps ?? 0;

  let escrowId: string;
  let chargedAmount: number;
  let chargedQuoteId: string;
  try {
    // Reuse the #18 quote engine to re-price FX at charge time.
    const quote = createQuote({
      apiKeyId: sub.apiKeyId,
      from: sub.from as 'CRC' | 'MXN' | 'USD',
      to: sub.to as 'CRC' | 'MXN' | 'USD',
      amount: sub.amount,
      spreadBps,
    });

    const escrow = getSimulator().createEscrow({
      apiKeyId: sub.apiKeyId,
      sessionId: sub.sessionId,
      quoteId: quote.quoteId,
      amount: String(quote.toAmount),
      asset: sub.asset,
    });

    const quoteSnapshot: Prisma.InputJsonValue = {
      quoteId: quote.quoteId,
      effectiveRate: quote.effectiveRate,
      toAmount: quote.toAmount,
      token: quote.token,
    };

    await prisma.subscriptionCharge.create({
      data: {
        subscriptionId: sub.id,
        status: 'succeeded',
        quote: quoteSnapshot,
        escrowId: escrow.id,
        attempt: sub.attemptCount + 1,
      },
    });

    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        attemptCount: 0,
        failNextCharge: false,
        nextChargeAt: new Date(now.getTime() + getChargeIntervalMs()),
      },
    });

    escrowId = escrow.id;
    chargedAmount = quote.toAmount;
    chargedQuoteId = quote.quoteId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'charge_error';
    return failCharge(sub.id, sub.apiKeyId, sub.attemptCount, reason);
  }

  // Charge is committed. Emit AFTER the try so a webhook-dispatch failure cannot
  // roll the subscription into a bogus failed charge / double-charge next tick.
  await emitSubscriptionCharged(sub.apiKeyId, {
    subscriptionId: sub.id,
    escrowId,
    amount: chargedAmount,
    asset: sub.asset,
    quoteId: chargedQuoteId,
  });

  return {
    subscriptionId: sub.id,
    status: 'succeeded',
    escrowId,
    subscriptionStatus: 'active',
  };
}

async function failCharge(
  subscriptionId: string,
  apiKeyId: string,
  previousAttempts: number,
  reason: string,
): Promise<ChargeResult> {
  const attempt = previousAttempts + 1;
  const maxAttempts = getMaxAttempts();
  const exhausted = attempt >= maxAttempts;

  await prisma.subscriptionCharge.create({
    data: {
      subscriptionId,
      status: 'failed',
      quote: {},
      failureReason: reason,
      attempt,
    },
  });

  const nextChargeAt = exhausted
    ? new Date()
    : new Date(Date.now() + computeRetryBackoffMs(attempt));
  const status: SubscriptionStatus = exhausted ? 'past_due' : 'active';

  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      attemptCount: attempt,
      failNextCharge: false,
      status,
      nextChargeAt,
    },
  });

  if (exhausted) {
    await emitSubscriptionFailed(apiKeyId, {
      subscriptionId,
      reason,
      attempts: attempt,
    });
  }

  return { subscriptionId, status: 'failed', subscriptionStatus: status };
}
