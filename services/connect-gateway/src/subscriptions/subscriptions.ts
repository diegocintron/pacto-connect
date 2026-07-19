import type { Subscription } from '@prisma/client';
import { prisma } from '../db.js';
import { SubscriptionError } from '../errors.js';
import { type FxCurrency, isFxCurrency } from '../fx-oracle.js';

export type SubscriptionInterval = 'day' | 'week' | 'month';

export const SUBSCRIPTION_INTERVALS: readonly SubscriptionInterval[] = ['day', 'week', 'month'];

export function isSubscriptionInterval(value: string): value is SubscriptionInterval {
  return (SUBSCRIPTION_INTERVALS as readonly string[]).includes(value);
}

const DEFAULT_CHARGE_INTERVAL_MS = 3000;

// Test mode uses an accelerated tick so recurring cycles are observable. Live
// scheduling (day/week/month) is out of scope; the semantic interval is stored
// on the row for API fidelity.
export function getChargeIntervalMs(): number {
  const configured = process.env.TESTMODE_SUB_INTERVAL_MS;
  if (!configured) {
    return DEFAULT_CHARGE_INTERVAL_MS;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHARGE_INTERVAL_MS;
  }

  return parsed;
}

export interface CreateSubscriptionInput {
  apiKeyId: string;
  sessionId: string;
  from: string;
  to: string;
  amount: number;
  interval: string;
  asset?: string;
  payerRef?: string;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
  if (!isFxCurrency(input.from) || !isFxCurrency(input.to)) {
    throw new SubscriptionError('subscription_invalid', 'from and to must be one of CRC, MXN, USD');
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new SubscriptionError('subscription_invalid', 'amount must be a positive number');
  }

  if (!isSubscriptionInterval(input.interval)) {
    throw new SubscriptionError('subscription_invalid', 'interval must be day, week, or month');
  }

  const nextChargeAt = new Date(Date.now() + getChargeIntervalMs());

  return prisma.subscription.create({
    data: {
      apiKeyId: input.apiKeyId,
      sessionId: input.sessionId,
      payerRef: input.payerRef ?? null,
      from: input.from,
      to: input.to,
      amount: input.amount,
      asset: input.asset ?? 'USDC',
      interval: input.interval,
      nextChargeAt,
    },
  });
}

export async function getSubscription(id: string, apiKeyId: string): Promise<Subscription | null> {
  return prisma.subscription.findFirst({ where: { id, apiKeyId } });
}

export async function listSubscriptions(
  apiKeyId: string,
  sessionId?: string,
): Promise<Subscription[]> {
  return prisma.subscription.findMany({
    where: { apiKeyId, ...(sessionId ? { sessionId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function cancelSubscription(
  id: string,
  apiKeyId: string,
): Promise<Subscription | null> {
  const existing = await prisma.subscription.findFirst({ where: { id, apiKeyId } });
  if (!existing) {
    return null;
  }

  if (existing.status === 'canceled') {
    return existing;
  }

  return prisma.subscription.update({
    where: { id },
    data: { status: 'canceled', canceledAt: new Date() },
  });
}

export type { FxCurrency };
