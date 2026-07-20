import type { ApiKey, CheckoutSession } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { PUBLISHABLE_KEY_HEADER } from '../middleware/origin.js';
import { buildClientSecret, hashClientSecret } from '../sessions.js';
import { getSimulator, resetSimulator } from '../testmode/simulator.js';

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
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  rotatedFromId: null,
  graceExpiresAt: null,
};

const liveApiKey: ApiKey = {
  ...mockApiKey,
  publishableKey: 'pk_live_mockkey',
  mode: 'live',
};

const sessionExpiresAt = new Date('2024-06-01T12:15:00.000Z');

let clientSecret: string;
let mockCheckoutSession: CheckoutSession;

vi.mock('../keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  normalizeOrigin: (raw: string) => {
    try {
      const u = new URL(raw);
      return u.origin.toLowerCase();
    } catch {
      return null;
    }
  },
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    checkoutSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../subscriptions/charge.js', () => ({ chargeSubscription: vi.fn() }));

import { prisma } from '../db.js';
import * as keys from '../keys.js';
import { chargeSubscription } from '../subscriptions/charge.js';

function testHeaders(apiKey: ApiKey = mockApiKey) {
  return {
    Origin: 'https://allowed.example',
    [PUBLISHABLE_KEY_HEADER]: apiKey.publishableKey,
    Authorization: `Bearer ${clientSecret}`,
    'Content-Type': 'application/json',
  };
}

async function createFundedEscrow(app: ReturnType<typeof createApp>) {
  const createRes = await app.request('/v1/escrows', {
    method: 'POST',
    headers: testHeaders(),
    body: JSON.stringify({ quoteId: 'quote_1' }),
  });
  const { escrow } = await createRes.json();

  await app.request(`/v1/escrows/${escrow.id}/deposit`, {
    method: 'POST',
    headers: testHeaders(),
    body: JSON.stringify({}),
  });

  return escrow.id as string;
}

describe('test control routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    resetSimulator();

    clientSecret = buildClientSecret('session_1', mockApiKey.id, sessionExpiresAt);
    mockCheckoutSession = {
      id: 'session_1',
      apiKeyId: mockApiKey.id,
      mode: 'buy',
      listingId: 'listing_1',
      quote: null,
      clientSecretHash: hashClientSecret(clientSecret),
      status: 'active',
      expiresAt: sessionExpiresAt,
      refreshCount: 0,
      createdAt: new Date('2024-06-01T12:00:00.000Z'),
      updatedAt: new Date('2024-06-01T12:00:00.000Z'),
    };

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);
  });

  it('disputes, times out, and releases escrows with a test key', async () => {
    const app = createApp();
    const simulator = getSimulator();

    const escrowId = await createFundedEscrow(app);

    const disputeRes = await app.request(`/v1/test/escrows/${escrowId}/dispute`, {
      method: 'POST',
      headers: testHeaders(),
      body: JSON.stringify({ reason: 'manual_review' }),
    });

    expect(disputeRes.status).toBe(200);
    const disputed = await disputeRes.json();
    expect(disputed.escrow.status).toBe('disputed');

    const eventsAfterDispute = simulator.getEventsSince(
      'session_1',
      escrowId,
      undefined,
      mockApiKey.id,
    );
    expect(eventsAfterDispute.at(-1)).toMatchObject({
      type: 'disputed',
      data: { reason: 'manual_review' },
    });

    resetSimulator();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);

    const timeoutEscrowId = await createFundedEscrow(app);
    const timeoutRes = await app.request(`/v1/test/escrows/${timeoutEscrowId}/timeout`, {
      method: 'POST',
      headers: testHeaders(),
    });

    expect(timeoutRes.status).toBe(200);
    const timedOut = await timeoutRes.json();
    expect(timedOut.escrow.status).toBe('disputed');

    resetSimulator();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);

    const releaseEscrowId = await createFundedEscrow(app);
    const releaseRes = await app.request(`/v1/test/escrows/${releaseEscrowId}/release`, {
      method: 'POST',
      headers: testHeaders(),
    });

    expect(releaseRes.status).toBe(200);
    const released = await releaseRes.json();
    expect(released.escrow.status).toBe('released');
  });

  it('returns 403 for live keys', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(liveApiKey);

    const app = createApp();
    const res = await app.request('/v1/test/escrows/esc_123/dispute', {
      method: 'POST',
      headers: testHeaders(liveApiKey),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        type: 'forbidden',
        code: 'live_key_not_allowed',
        message: 'test controls require a test-mode key',
      },
    });
  });
});

describe('subscription test controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    resetSimulator();

    clientSecret = buildClientSecret('session_1', mockApiKey.id, sessionExpiresAt);
    mockCheckoutSession = {
      id: 'session_1',
      apiKeyId: mockApiKey.id,
      mode: 'buy',
      listingId: 'listing_1',
      quote: null,
      clientSecretHash: hashClientSecret(clientSecret),
      status: 'active',
      expiresAt: sessionExpiresAt,
      refreshCount: 0,
      createdAt: new Date('2024-06-01T12:00:00.000Z'),
      updatedAt: new Date('2024-06-01T12:00:00.000Z'),
    };

    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(prisma.checkoutSession.findUnique).mockReset();
    vi.mocked(prisma.subscription.findFirst).mockReset();
    vi.mocked(prisma.subscription.update).mockReset();
    vi.mocked(chargeSubscription).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(mockCheckoutSession);
  });

  it('POST /v1/test/subscriptions/:id/advance charges synchronously', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub_1',
      apiKeyId: 'key_1',
      sessionId: 'session_1',
    } as never);
    vi.mocked(chargeSubscription).mockResolvedValue({
      subscriptionId: 'sub_1',
      status: 'succeeded',
      escrowId: 'esc_1',
      subscriptionStatus: 'active',
    });
    const app = createApp();
    const res = await app.request('/v1/test/subscriptions/sub_1/advance', {
      method: 'POST',
      headers: testHeaders(),
    });
    expect(res.status).toBe(200);
    expect(chargeSubscription).toHaveBeenCalledWith('sub_1');
  });

  it('POST /v1/test/subscriptions/:id/fail-next sets failNextCharge', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'sub_1',
      apiKeyId: 'key_1',
      sessionId: 'session_1',
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      id: 'sub_1',
      failNextCharge: true,
    } as never);
    const app = createApp();
    const res = await app.request('/v1/test/subscriptions/sub_1/fail-next', {
      method: 'POST',
      headers: testHeaders(),
    });
    expect(res.status).toBe(200);
    const args = vi.mocked(prisma.subscription.update).mock.calls[0]![0];
    expect(args.data.failNextCharge).toBe(true);
  });
});
