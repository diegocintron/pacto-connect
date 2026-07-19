import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: { subscription: { findMany: vi.fn() } },
}));

vi.mock('./charge.js', () => ({
  chargeSubscription: vi.fn(),
}));

import { prisma } from '../db.js';
import { chargeSubscription } from './charge.js';
import { getSubscriptionPollIntervalMs, runDueSubscriptions } from './runner.js';

const now = new Date('2026-07-18T12:00:00.000Z');

describe('subscription runner', () => {
  beforeEach(() => {
    delete process.env.SUBSCRIPTION_POLL_INTERVAL_MS;
    vi.mocked(prisma.subscription.findMany).mockReset();
    vi.mocked(chargeSubscription).mockReset();
  });

  it('getSubscriptionPollIntervalMs defaults to 5000 and reads env', () => {
    expect(getSubscriptionPollIntervalMs()).toBe(5000);
    process.env.SUBSCRIPTION_POLL_INTERVAL_MS = '2000';
    expect(getSubscriptionPollIntervalMs()).toBe(2000);
  });

  it('charges each due subscription and tallies results', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { id: 'sub_1' },
      { id: 'sub_2' },
    ] as never);
    vi.mocked(chargeSubscription)
      .mockResolvedValueOnce({
        subscriptionId: 'sub_1',
        status: 'succeeded',
        subscriptionStatus: 'active',
      })
      .mockResolvedValueOnce({
        subscriptionId: 'sub_2',
        status: 'failed',
        subscriptionStatus: 'active',
      });

    const tally = await runDueSubscriptions({ now });

    expect(chargeSubscription).toHaveBeenCalledWith('sub_1');
    expect(chargeSubscription).toHaveBeenCalledWith('sub_2');
    expect(tally).toEqual({ processed: 2, charged: 1, failed: 1 });
    const where = vi.mocked(prisma.subscription.findMany).mock.calls[0]![0]!.where!;
    expect(where.status).toBe('active');
    expect(where.nextChargeAt).toEqual({ lte: now });
  });
});
