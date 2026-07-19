import type { ApiKey, CheckoutSession, Subscription } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { PUBLISHABLE_KEY_HEADER } from '../middleware/origin.js';
import { buildClientSecret, hashClientSecret } from '../sessions.js';

const mockApiKey: ApiKey = {
  id: 'key_1',
  publishableKey: 'pk_test_mockkey',
  secretKeyHash: 'hash',
  secretLast4: 'abcd',
  mode: 'test',
  allowedOrigins: ['https://allowed.example'],
  status: 'active',
  label: null,
  quoteSpreadBps: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const liveApiKey: ApiKey = { ...mockApiKey, publishableKey: 'pk_live_mockkey', mode: 'live' };

const now = new Date('2026-07-18T12:00:00.000Z');
const sessionExpiresAt = new Date('2026-07-18T12:15:00.000Z');
let clientSecret: string;
let mockSession: CheckoutSession;

vi.mock('../keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    checkoutSession: { findUnique: vi.fn(), update: vi.fn() },
    subscription: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    idempotencyRecord: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../webhooks/events.js', () => ({
  emitSubscriptionCreated: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
  emitSubscriptionCanceled: vi.fn().mockResolvedValue({ eventId: 'evt', deliveries: 0 }),
}));

import { prisma } from '../db.js';
import * as keys from '../keys.js';
import { emitSubscriptionCanceled, emitSubscriptionCreated } from '../webhooks/events.js';

function headers(apiKey: ApiKey = mockApiKey) {
  return {
    Origin: 'https://allowed.example',
    [PUBLISHABLE_KEY_HEADER]: apiKey.publishableKey,
    Authorization: `Bearer ${clientSecret}`,
    'Content-Type': 'application/json',
  };
}

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

describe('subscription routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.TESTMODE_SUB_INTERVAL_MS = '3000';
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(prisma.subscription.create).mockReset();
    vi.mocked(prisma.subscription.findFirst).mockReset();
    vi.mocked(prisma.subscription.findMany).mockReset();
    vi.mocked(prisma.subscription.update).mockReset();
    vi.mocked(prisma.idempotencyRecord.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue({} as never);
    vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as never);
    vi.mocked(emitSubscriptionCreated).mockClear();
    vi.mocked(emitSubscriptionCanceled).mockClear();

    clientSecret = buildClientSecret('session_1', mockApiKey.id, sessionExpiresAt);
    mockSession = {
      id: 'session_1',
      apiKeyId: mockApiKey.id,
      mode: 'buy',
      listingId: 'listing_1',
      quote: null,
      clientSecretHash: hashClientSecret(clientSecret),
      status: 'active',
      expiresAt: sessionExpiresAt,
      refreshCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockImplementation(async (pk: string) =>
      pk === liveApiKey.publishableKey ? liveApiKey : mockApiKey,
    );
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockSession);
  });

  it('POST /v1/subscriptions creates a subscription and emits subscription.created', async () => {
    vi.mocked(prisma.subscription.create).mockResolvedValue(buildSub());
    const app = createApp();

    const res = await app.request('/v1/subscriptions', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        from: 'USD',
        to: 'CRC',
        amount: 100,
        interval: 'month',
        payerRef: 'cust_42',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { id: string; status: string } };
    expect(body.subscription.id).toBe('sub_1');
    expect(body.subscription.status).toBe('active');
    expect(emitSubscriptionCreated).toHaveBeenCalledWith(
      'key_1',
      expect.objectContaining({ subscriptionId: 'sub_1' }),
    );
    expect(emitSubscriptionCreated).toHaveBeenCalledTimes(1);
  });

  it('POST /v1/subscriptions rejects an invalid interval with 400', async () => {
    const app = createApp();
    const res = await app.request('/v1/subscriptions', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100, interval: 'year' }),
    });
    expect(res.status).toBe(400);
    expect(emitSubscriptionCreated).not.toHaveBeenCalled();
  });

  it('POST /v1/subscriptions rejects a malformed JSON body with 400', async () => {
    const app = createApp();
    const res = await app.request('/v1/subscriptions', {
      method: 'POST',
      headers: headers(),
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('POST /v1/subscriptions on a live key returns 501', async () => {
    const app = createApp();
    clientSecret = buildClientSecret('session_1', liveApiKey.id, sessionExpiresAt);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue({
      ...mockSession,
      apiKeyId: liveApiKey.id,
      clientSecretHash: hashClientSecret(clientSecret),
    });
    const res = await app.request('/v1/subscriptions', {
      method: 'POST',
      headers: headers(liveApiKey),
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100, interval: 'month' }),
    });
    expect(res.status).toBe(501);
  });

  it('GET /v1/subscriptions returns the list of subscriptions', async () => {
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([buildSub()]);
    const app = createApp();
    const res = await app.request('/v1/subscriptions', { headers: headers() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscriptions: { id: string }[] };
    expect(body.subscriptions[0]!.id).toBe('sub_1');
  });

  it('GET /v1/subscriptions/:id returns the subscription', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(buildSub());
    const app = createApp();
    const res = await app.request('/v1/subscriptions/sub_1', { headers: headers() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { id: string } };
    expect(body.subscription.id).toBe('sub_1');
    expect(vi.mocked(prisma.subscription.findFirst).mock.calls[0]![0]!.where).toEqual(
      expect.objectContaining({ id: 'sub_1', apiKeyId: 'key_1', sessionId: 'session_1' }),
    );
  });

  it('GET /v1/subscriptions/:id returns 404 when missing', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
    const app = createApp();
    const res = await app.request('/v1/subscriptions/missing', { headers: headers() });
    expect(res.status).toBe(404);
    expect(emitSubscriptionCreated).not.toHaveBeenCalled();
  });

  it('POST /v1/subscriptions/:id/cancel cancels and emits subscription.canceled', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(buildSub());
    vi.mocked(prisma.subscription.update).mockResolvedValue(
      buildSub({ status: 'canceled', canceledAt: now }),
    );
    const app = createApp();
    const res = await app.request('/v1/subscriptions/sub_1/cancel', {
      method: 'POST',
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { status: string } };
    expect(body.subscription.status).toBe('canceled');
    expect(emitSubscriptionCanceled).toHaveBeenCalledWith(
      'key_1',
      expect.objectContaining({ subscriptionId: 'sub_1' }),
    );
    expect(emitSubscriptionCanceled).toHaveBeenCalledTimes(1);
  });
});
