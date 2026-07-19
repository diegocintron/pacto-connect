import type { Subscription } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: {
    subscription: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../db.js';
import { SubscriptionError } from '../errors.js';
import {
  cancelSubscription,
  createSubscription,
  getChargeIntervalMs,
  isSubscriptionInterval,
} from './subscriptions.js';

const now = new Date('2026-07-18T12:00:00.000Z');

function buildSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_1',
    apiKeyId: 'key_1',
    sessionId: 'session_1',
    payerRef: 'cust_42',
    from: 'USD',
    to: 'CRC',
    amount: 100,
    asset: 'USDC',
    interval: 'month',
    status: 'active',
    attemptCount: 0,
    failNextCharge: false,
    nextChargeAt: now,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('subscription domain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    delete process.env.TESTMODE_SUB_INTERVAL_MS;
    vi.mocked(prisma.subscription.create).mockReset();
    vi.mocked(prisma.subscription.findFirst).mockReset();
    vi.mocked(prisma.subscription.update).mockReset();
  });

  it('isSubscriptionInterval accepts day/week/month only', () => {
    expect(isSubscriptionInterval('week')).toBe(true);
    expect(isSubscriptionInterval('year')).toBe(false);
  });

  it('getChargeIntervalMs defaults to 3000 and reads the env override', () => {
    expect(getChargeIntervalMs()).toBe(3000);
    process.env.TESTMODE_SUB_INTERVAL_MS = '1500';
    expect(getChargeIntervalMs()).toBe(1500);
  });

  it('createSubscription persists with nextChargeAt = now + interval and returns the row', async () => {
    const created = buildSub();
    vi.mocked(prisma.subscription.create).mockResolvedValue(created);

    const result = await createSubscription({
      apiKeyId: 'key_1',
      sessionId: 'session_1',
      from: 'USD',
      to: 'CRC',
      amount: 100,
      interval: 'month',
      payerRef: 'cust_42',
    });

    expect(result).toBe(created);
    const args = vi.mocked(prisma.subscription.create).mock.calls[0]![0];
    expect(args.data.nextChargeAt).toEqual(new Date(now.getTime() + 3000));
    expect(args.data.asset).toBe('USDC');
  });

  it('createSubscription rejects an unsupported currency', async () => {
    await expect(
      createSubscription({
        apiKeyId: 'key_1',
        sessionId: 'session_1',
        from: 'GBP',
        to: 'CRC',
        amount: 100,
        interval: 'month',
      }),
    ).rejects.toBeInstanceOf(SubscriptionError);
  });

  it('createSubscription rejects a non-positive amount', async () => {
    await expect(
      createSubscription({
        apiKeyId: 'key_1',
        sessionId: 'session_1',
        from: 'USD',
        to: 'CRC',
        amount: 0,
        interval: 'month',
      }),
    ).rejects.toBeInstanceOf(SubscriptionError);
  });

  it('cancelSubscription sets status=canceled and canceledAt', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(buildSub());
    const canceled = buildSub({ status: 'canceled', canceledAt: now });
    vi.mocked(prisma.subscription.update).mockResolvedValue(canceled);

    const result = await cancelSubscription('sub_1', 'key_1', 'session_1');

    expect(result?.status).toBe('canceled');
    const findArgs = vi.mocked(prisma.subscription.findFirst).mock.calls[0]![0];
    expect(findArgs?.where).toEqual(
      expect.objectContaining({ id: 'sub_1', apiKeyId: 'key_1', sessionId: 'session_1' }),
    );
    const args = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(args.data.status).toBe('canceled');
    expect(args.data.canceledAt).toEqual(now);
  });

  it('cancelSubscription returns null when not found', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    expect(await cancelSubscription('missing', 'key_1', 'session_1')).toBeNull();
  });
});
