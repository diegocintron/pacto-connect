import { prisma } from '../db.js';
import { chargeSubscription } from './charge.js';

export const DEFAULT_POLL_INTERVAL_MS = 5000;

export function getSubscriptionPollIntervalMs(): number {
  const configured = process.env.SUBSCRIPTION_POLL_INTERVAL_MS;
  if (!configured) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return parsed;
}

export interface SubscriptionRunResult {
  processed: number;
  charged: number;
  failed: number;
}

export async function runDueSubscriptions(options?: {
  now?: Date;
  limit?: number;
}): Promise<SubscriptionRunResult> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 20;

  const due = await prisma.subscription.findMany({
    where: { status: 'active', nextChargeAt: { lte: now } },
    orderBy: { nextChargeAt: 'asc' },
    take: limit,
  });

  const tally: SubscriptionRunResult = { processed: 0, charged: 0, failed: 0 };

  for (const sub of due) {
    const result = await chargeSubscription(sub.id);
    tally.processed += 1;
    if (result.status === 'succeeded') {
      tally.charged += 1;
    } else {
      tally.failed += 1;
    }
  }

  return tally;
}

export interface SubscriptionRunner {
  stop: () => void;
}

export function startSubscriptionRunner(options?: { intervalMs?: number }): SubscriptionRunner {
  const intervalMs = options?.intervalMs ?? getSubscriptionPollIntervalMs();
  let running = false;

  const timer = setInterval(async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      await runDueSubscriptions();
    } catch (error) {
      console.error('subscription runner:', error);
    } finally {
      running = false;
    }
  }, intervalMs);

  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}
