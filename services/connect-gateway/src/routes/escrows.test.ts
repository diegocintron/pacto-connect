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
  },
}));

import { prisma } from '../db.js';
import * as keys from '../keys.js';

function escrowHeaders(apiKey: ApiKey = mockApiKey) {
  return {
    Origin: 'https://allowed.example',
    [PUBLISHABLE_KEY_HEADER]: apiKey.publishableKey,
    Authorization: `Bearer ${clientSecret}`,
    'Content-Type': 'application/json',
  };
}

describe('escrow routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.TESTMODE_RELEASE_DELAY_MS = '3000';
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

  it('creates, deposits, and reports fiat in test mode', async () => {
    const app = createApp();

    const createRes = await app.request('/v1/escrows', {
      method: 'POST',
      headers: escrowHeaders(),
      body: JSON.stringify({ quoteId: 'quote_1', amount: '150', asset: 'USDC' }),
    });

    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.escrow.status).toBe('pending');
    expect(created.escrow.quoteId).toBe('quote_1');

    const depositRes = await app.request(`/v1/escrows/${created.escrow.id}/deposit`, {
      method: 'POST',
      headers: escrowHeaders(),
      body: JSON.stringify({ testMode: true }),
    });

    expect(depositRes.status).toBe(200);
    const deposited = await depositRes.json();
    expect(deposited.escrow.status).toBe('funded');

    const fiatRes = await app.request(`/v1/escrows/${created.escrow.id}/fiat-report`, {
      method: 'POST',
      headers: escrowHeaders(),
      body: JSON.stringify({ method: 'SINPE', reference: 'ref-123' }),
    });

    expect(fiatRes.status).toBe(200);
    const reported = await fiatRes.json();
    expect(reported.escrow.status).toBe('funded');
  });

  it('returns 501 for live keys', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(liveApiKey);

    const app = createApp();
    const res = await app.request('/v1/escrows', {
      method: 'POST',
      headers: escrowHeaders(liveApiKey),
      body: JSON.stringify({ quoteId: 'quote_1' }),
    });

    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({
      error: {
        type: 'gateway_error',
        code: 'not_implemented',
        message: 'live escrow proxy not available',
      },
    });
  });

  it('rejects requests without a client secret', async () => {
    const app = createApp();
    const res = await app.request('/v1/escrows', {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ quoteId: 'quote_1' }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        type: 'validation_error',
        code: 'invalid_request',
        message: 'Authorization Bearer client secret is required',
      },
    });
  });

  it('rejects invalid client secrets', async () => {
    vi.mocked(prisma.checkoutSession.findUnique).mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/v1/escrows', {
      method: 'POST',
      headers: escrowHeaders(),
      body: JSON.stringify({ quoteId: 'quote_1' }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        type: 'session_error',
        code: 'session_invalid',
        message: 'Session not found',
      },
    });
  });

  it('replays events via cursor query on the events route', async () => {
    const app = createApp();
    const simulator = getSimulator();

    const createRes = await app.request('/v1/escrows', {
      method: 'POST',
      headers: escrowHeaders(),
      body: JSON.stringify({ quoteId: 'quote_1' }),
    });
    const { escrow } = await createRes.json();

    simulator.deposit('session_1', escrow.id, mockApiKey.id);

    const events = simulator.getEventsSince('session_1', escrow.id, undefined, mockApiKey.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('escrow.funded');

    const catchUpRes = await app.request(`/v1/escrows/events?escrowId=${escrow.id}`, {
      headers: escrowHeaders(),
      signal: AbortSignal.timeout(100),
    });

    expect(catchUpRes.status).toBe(200);
    expect(catchUpRes.headers.get('Content-Type')).toContain('text/event-stream');

    const text = await catchUpRes.text();
    expect(text).toContain('event: escrow.funded');
    expect(text).toContain(`id: ${events[0]?.cursor}`);
  });
});
