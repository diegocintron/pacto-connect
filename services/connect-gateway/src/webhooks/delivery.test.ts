import type { WebhookDeliveryStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEndpoint = {
  id: 'wh_ep_1',
  apiKeyId: 'key_1',
  url: 'https://example.com/webhook',
  secret: 'whsec_test_secret',
  enabledEvents: ['escrow.created'],
  status: 'enabled' as const,
  verified: true,
  description: null,
  createdAt: new Date('2024-06-01T12:00:00.000Z'),
  updatedAt: new Date('2024-06-01T12:00:00.000Z'),
};

const mockEvent = {
  id: 'wh_evt_1',
  apiKeyId: 'key_1',
  type: 'escrow.created',
  data: { escrowId: 'esc_1' },
  sourceEventId: null,
  createdAt: new Date('2024-06-01T12:00:00.000Z'),
};

const mockDeliveryBase = {
  id: 'wh_del_1',
  endpointId: 'wh_ep_1',
  eventId: 'wh_evt_1',
  eventType: 'escrow.created',
  status: 'pending' as WebhookDeliveryStatus,
  attempts: 0,
  maxAttempts: 5,
  nextAttemptAt: new Date('2024-06-01T12:00:00.000Z'),
  lastError: null,
  lastStatusCode: null,
  deliveredAt: null,
  createdAt: new Date('2024-06-01T12:00:00.000Z'),
  updatedAt: new Date('2024-06-01T12:00:00.000Z'),
};

function buildDeliveryWithIncludes(overrides: Partial<typeof mockDeliveryBase> = {}) {
  return {
    ...mockDeliveryBase,
    ...overrides,
    endpoint: mockEndpoint,
    event: mockEvent,
  };
}

vi.mock('../db.js', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    webhookEndpoint: {
      findMany: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('./transport.js', () => ({
  postSignedWebhook: vi.fn(),
}));

import type { WebhookDelivery, WebhookEvent } from '@prisma/client';
import { prisma } from '../db.js';
import {
  attemptDelivery,
  computeBackoffMs,
  dispatchEvent,
  getBackoffBaseMs,
  getBackoffCapMs,
  requeueDelivery,
  runDueDeliveries,
} from './delivery.js';
import { postSignedWebhook } from './transport.js';

describe('webhook delivery engine', () => {
  const now = new Date('2024-06-01T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    delete process.env.WEBHOOK_MAX_ATTEMPTS;
    delete process.env.WEBHOOK_BACKOFF_BASE_MS;
    delete process.env.WEBHOOK_BACKOFF_CAP_MS;
    vi.mocked(prisma.webhookEvent.create).mockReset();
    vi.mocked(prisma.webhookEndpoint.findMany).mockReset();
    vi.mocked(prisma.webhookDelivery.create).mockReset();
    vi.mocked(prisma.webhookDelivery.findUnique).mockReset();
    vi.mocked(prisma.webhookDelivery.findMany).mockReset();
    vi.mocked(prisma.webhookDelivery.update).mockReset();
    vi.mocked(postSignedWebhook).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computeBackoffMs is exponential and caps at getBackoffCapMs', () => {
    process.env.WEBHOOK_BACKOFF_BASE_MS = '1000';
    process.env.WEBHOOK_BACKOFF_CAP_MS = '10000';

    expect(computeBackoffMs(1)).toBe(1000);
    expect(computeBackoffMs(2)).toBe(2000);
    expect(computeBackoffMs(3)).toBe(4000);
    expect(computeBackoffMs(20)).toBe(getBackoffCapMs());
  });

  it('dispatchEvent creates one event and one delivery per matching endpoint', async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue(mockEvent as WebhookEvent);
    vi.mocked(prisma.webhookEndpoint.findMany).mockResolvedValue([
      { ...mockEndpoint, id: 'wh_ep_1' },
      { ...mockEndpoint, id: 'wh_ep_2' },
    ]);
    vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({} as WebhookDelivery);

    const result = await dispatchEvent({
      apiKeyId: 'key_1',
      type: 'escrow.created',
      data: { escrowId: 'esc_1' },
    });

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'key_1',
        type: 'escrow.created',
        data: { escrowId: 'esc_1' },
      },
    });
    expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith({
      where: {
        apiKeyId: 'key_1',
        status: 'enabled',
        verified: true,
        enabledEvents: { has: 'escrow.created' },
      },
    });
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ eventId: 'wh_evt_1', deliveries: 2 });
  });

  it('attemptDelivery succeeds and records deliveredAt', async () => {
    const delivery = buildDeliveryWithIncludes();
    vi.mocked(prisma.webhookDelivery.findUnique).mockResolvedValue(delivery);
    vi.mocked(postSignedWebhook).mockResolvedValue({ ok: true, status: 200 });
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as WebhookDelivery);

    const result = await attemptDelivery('wh_del_1', { now });

    expect(postSignedWebhook).toHaveBeenCalledWith(
      'https://example.com/webhook',
      JSON.stringify({
        id: 'wh_evt_1',
        type: 'escrow.created',
        created: Math.floor(mockEvent.createdAt.getTime() / 1000),
        data: mockEvent.data,
      }),
      'whsec_test_secret',
      { fetchImpl: undefined },
    );
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wh_del_1' },
      data: {
        status: 'succeeded',
        attempts: 1,
        deliveredAt: now,
        lastStatusCode: 200,
        lastError: null,
      },
    });
    expect(result).toEqual({ deliveryId: 'wh_del_1', status: 'succeeded', statusCode: 200 });
  });

  it('attemptDelivery schedules retry on transient failure', async () => {
    process.env.WEBHOOK_BACKOFF_BASE_MS = '5000';
    const delivery = buildDeliveryWithIncludes({ attempts: 0, maxAttempts: 5 });
    vi.mocked(prisma.webhookDelivery.findUnique).mockResolvedValue(delivery);
    vi.mocked(postSignedWebhook).mockResolvedValue({ ok: false, status: 500 });
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as WebhookDelivery);

    const result = await attemptDelivery('wh_del_1', { now });

    const updateCall = vi.mocked(prisma.webhookDelivery.update).mock.calls[0]?.[0];
    expect(updateCall?.data.status).toBe('failed');
    expect(updateCall?.data.attempts).toBe(1);
    expect(updateCall?.data.nextAttemptAt).toBeInstanceOf(Date);
    expect((updateCall?.data.nextAttemptAt as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(result).toEqual({
      deliveryId: 'wh_del_1',
      status: 'failed',
      statusCode: 500,
      error: 'unexpected status 500',
    });
  });

  it('attemptDelivery moves exhausted deliveries to dead letter queue', async () => {
    const delivery = buildDeliveryWithIncludes({
      attempts: 4,
      maxAttempts: 5,
      status: 'failed',
    });
    vi.mocked(prisma.webhookDelivery.findUnique).mockResolvedValue(delivery);
    vi.mocked(postSignedWebhook).mockResolvedValue({ ok: false, error: 'timeout' });
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as WebhookDelivery);

    const result = await attemptDelivery('wh_del_1', { now });

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wh_del_1' },
      data: {
        status: 'dead',
        attempts: 5,
        lastStatusCode: null,
        lastError: 'timeout',
        nextAttemptAt: delivery.nextAttemptAt,
      },
    });
    expect(result).toEqual({
      deliveryId: 'wh_del_1',
      status: 'dead',
      statusCode: undefined,
      error: 'timeout',
    });
  });

  it('runDueDeliveries processes due deliveries and tallies outcomes', async () => {
    const deliveryOne = buildDeliveryWithIncludes({ id: 'wh_del_1', attempts: 0 });
    const deliveryTwo = buildDeliveryWithIncludes({ id: 'wh_del_2', attempts: 0 });

    vi.mocked(prisma.webhookDelivery.findMany).mockResolvedValue([
      { ...mockDeliveryBase, id: 'wh_del_1' },
      { ...mockDeliveryBase, id: 'wh_del_2' },
    ] as WebhookDelivery[]);

    vi.mocked(prisma.webhookDelivery.findUnique)
      .mockResolvedValueOnce(deliveryOne)
      .mockResolvedValueOnce(deliveryTwo);
    vi.mocked(postSignedWebhook)
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as WebhookDelivery);

    const result = await runDueDeliveries({ now, limit: 10 });

    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['pending', 'failed'] },
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 10,
    });
    expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1, dead: 0 });
  });

  it('requeueDelivery resets a dead delivery and grants fresh attempts', async () => {
    const deadDelivery = {
      ...mockDeliveryBase,
      status: 'dead' as const,
      attempts: 5,
      maxAttempts: 5,
      lastError: 'timeout',
    };

    vi.mocked(prisma.webhookDelivery.findUnique).mockResolvedValue(deadDelivery as WebhookDelivery);
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({
      ...deadDelivery,
      status: 'pending',
      maxAttempts: 10,
      lastError: null,
    } as WebhookDelivery);

    const result = await requeueDelivery('wh_del_1');

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'wh_del_1' },
      data: {
        status: 'pending',
        nextAttemptAt: expect.any(Date),
        lastError: null,
        maxAttempts: 10,
      },
    });
    expect(result?.status).toBe('pending');
    expect(result?.maxAttempts).toBeGreaterThan(deadDelivery.attempts);
  });
});

describe('dispatchEvent source-event dedup', () => {
  beforeEach(() => {
    vi.mocked(prisma.webhookEvent.findUnique).mockReset?.();
    vi.mocked(prisma.webhookEvent.create).mockReset?.();
  });

  it('does not re-create or re-dispatch when the sourceEventId was already seen', async () => {
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValue({ id: 'evt_existing' } as never);

    const result = await dispatchEvent({
      apiKeyId: 'key_1',
      type: 'escrow.created',
      data: {},
      sourceEventId: 'up_evt_1',
    });

    expect(result).toEqual({ eventId: 'evt_existing', deliveries: 0, deduped: true });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });
});
