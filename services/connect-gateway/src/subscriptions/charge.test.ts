import type { ApiKey, Subscription } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  prisma: {
    subscription: { findUnique: vi.fn(), update: vi.fn() },
    subscriptionCharge: { create: vi.fn() },
    apiKey: { findUnique: vi.fn() },
  },
}));

vi.mock('../webhooks/events.js', () => ({
  emitSubscriptionCharged: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
  emitSubscriptionFailed: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
}));

import { prisma } from '../db.js';
import { resetSimulator } from '../testmode/simulator.js';
import { emitSubscriptionCharged, emitSubscriptionFailed } from '../webhooks/events.js';
import { chargeSubscription } from './charge.js';

const now = new Date('2026-07-18T12:00:00.000Z');

const mockApiKey = { id: 'key_1', quoteSpreadBps: 0 } as ApiKey;

function buildSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_1',
    apiKeyId: 'key_1',
    sessionId: 'session_1',
    payerRef: null,
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

describe('chargeSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.TESTMODE_SUB_INTERVAL_MS = '3000';
    delete process.env.SUBSCRIPTION_MAX_ATTEMPTS;
    resetSimulator();
    vi.mocked(prisma.subscription.findUnique).mockReset();
    vi.mocked(prisma.subscription.update).mockReset();
    vi.mocked(prisma.subscriptionCharge.create).mockReset();
    vi.mocked(prisma.apiKey.findUnique).mockReset();
    vi.mocked(emitSubscriptionCharged).mockClear();
    vi.mocked(emitSubscriptionFailed).mockClear();
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.subscription.update).mockImplementation((async (args: {
      data: Partial<Subscription>;
    }) => buildSub(args.data)) as unknown as typeof prisma.subscription.update);
  });

  it('creates an escrow, records a succeeded charge, emits subscription.charged, advances nextChargeAt', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(buildSub());

    const result = await chargeSubscription('sub_1');

    expect(result.status).toBe('succeeded');
    expect(result.escrowId).toMatch(/^esc_/);
    const charge = vi.mocked(prisma.subscriptionCharge.create).mock.calls[0]![0];
    expect(charge.data.status).toBe('succeeded');
    expect(charge.data.escrowId).toBe(result.escrowId);
    const update = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(update.data.nextChargeAt).toEqual(new Date(now.getTime() + 3000));
    expect(update.data.attemptCount).toBe(0);
    expect(emitSubscriptionCharged).toHaveBeenCalledTimes(1);
    expect(emitSubscriptionFailed).not.toHaveBeenCalled();
  });

  it('a webhook emit failure after a committed charge does not record a failed charge or reschedule', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(buildSub());
    vi.mocked(emitSubscriptionCharged).mockRejectedValueOnce(new Error('dispatch boom'));

    await expect(chargeSubscription('sub_1')).rejects.toThrow('dispatch boom');

    // exactly one charge row, and it is the succeeded one — never a failed one
    expect(prisma.subscriptionCharge.create).toHaveBeenCalledTimes(1);
    const charge = vi.mocked(prisma.subscriptionCharge.create).mock.calls[0]![0];
    expect(charge.data.status).toBe('succeeded');
  });

  it('failNextCharge: records a failed charge and retries while under the cap (stays active)', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      buildSub({ failNextCharge: true, attemptCount: 0 }),
    );

    const result = await chargeSubscription('sub_1');

    expect(result.status).toBe('failed');
    expect(result.subscriptionStatus).toBe('active');
    const charge = vi.mocked(prisma.subscriptionCharge.create).mock.calls[0]![0];
    expect(charge.data.status).toBe('failed');
    expect(charge.data.failureReason).toBe('insufficient_funds');
    const update = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(update.data.attemptCount).toBe(1);
    expect(update.data.failNextCharge).toBe(false);
    expect(update.data.status).toBe('active');
    expect(emitSubscriptionFailed).not.toHaveBeenCalled();
  });

  it('exhausting the cap sets status=past_due and emits subscription.failed exactly once', async () => {
    process.env.SUBSCRIPTION_MAX_ATTEMPTS = '3';
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      buildSub({ failNextCharge: true, attemptCount: 2 }),
    );

    const result = await chargeSubscription('sub_1');

    expect(result.status).toBe('failed');
    expect(result.subscriptionStatus).toBe('past_due');
    const update = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(update.data.status).toBe('past_due');
    expect(update.data.attemptCount).toBe(3);
    expect(emitSubscriptionFailed).toHaveBeenCalledTimes(1);
  });

  it('does not charge a canceled subscription', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(buildSub({ status: 'canceled' }));

    const result = await chargeSubscription('sub_1');

    expect(result.status).toBe('failed');
    expect(prisma.subscriptionCharge.create).not.toHaveBeenCalled();
    expect(emitSubscriptionCharged).not.toHaveBeenCalled();
    expect(emitSubscriptionFailed).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('routes an unexpected charge error (unsupported currency) through the bounded retry, staying active under the cap', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      buildSub({ to: 'JPY', attemptCount: 0 }),
    );

    const result = await chargeSubscription('sub_1');

    expect(result.status).toBe('failed');
    expect(result.subscriptionStatus).toBe('active');
    const charge = vi.mocked(prisma.subscriptionCharge.create).mock.calls[0]![0];
    expect(charge.data.status).toBe('failed');
    expect(charge.data.failureReason).toBeTruthy();
    const update = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(update.data.attemptCount).toBe(1);
    expect(update.data.status).toBe('active');
    expect(emitSubscriptionFailed).not.toHaveBeenCalled();
  });

  it('an unexpected charge error at the cap transitions to past_due and emits subscription.failed once', async () => {
    process.env.SUBSCRIPTION_MAX_ATTEMPTS = '3';
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(
      buildSub({ to: 'JPY', attemptCount: 2 }),
    );

    const result = await chargeSubscription('sub_1');

    expect(result.status).toBe('failed');
    expect(result.subscriptionStatus).toBe('past_due');
    const update = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(update.data.status).toBe('past_due');
    expect(emitSubscriptionFailed).toHaveBeenCalledTimes(1);
  });
});
