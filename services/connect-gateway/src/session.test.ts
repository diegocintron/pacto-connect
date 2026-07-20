import type { ApiKey } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { PUBLISHABLE_KEY_HEADER } from './middleware/origin.js';

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

vi.mock('./keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: (origin: string, allowed: string[]) => allowed.includes(origin),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  hashSecretKey: vi.fn(),
  generateKeyPair: vi.fn(),
}));

vi.mock('./sessions.js', () => ({
  createCheckoutSession: vi.fn(),
  refreshCheckoutSession: vi.fn(),
}));

vi.mock('./db.js', () => ({
  prisma: {},
}));

import { SessionError } from './errors.js';
import * as keys from './keys.js';
import * as sessions from './sessions.js';

const sessionHeaders = {
  Origin: 'https://allowed.example',
  [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
  'Content-Type': 'application/json',
};

describe('session routes', () => {
  beforeEach(() => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(sessions.createCheckoutSession).mockReset();
    vi.mocked(sessions.refreshCheckoutSession).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  });

  it('creates a checkout session with listingId', async () => {
    vi.mocked(sessions.createCheckoutSession).mockResolvedValue({
      sessionId: 'session_1',
      clientSecret: 'cs_session_1_signature',
      expiresAt: new Date('2024-01-01T00:15:00.000Z'),
      mode: 'buy',
    });

    const app = createApp();
    const res = await app.request('/v1/session', {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ listingId: 'listing_1', mode: 'buy' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('session_1');
    expect(body.clientSecret).toBe('cs_session_1_signature');
    expect(body.mode).toBe('buy');
    expect(sessions.createCheckoutSession).toHaveBeenCalledWith({
      apiKeyId: mockApiKey.id,
      mode: 'buy',
      listingId: 'listing_1',
      quote: undefined,
    });
  });

  it('rejects session creation without listingId or quote', async () => {
    const app = createApp();
    const res = await app.request('/v1/session', {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ mode: 'buy' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        type: 'validation_error',
        code: 'invalid_request',
        message: 'listingId or quote is required',
      },
    });
  });

  it('returns typed error for invalid session on refresh', async () => {
    vi.mocked(sessions.refreshCheckoutSession).mockRejectedValue(
      new SessionError('session_invalid', 'Client secret signature mismatch'),
    );

    const app = createApp();
    const res = await app.request('/v1/session/refresh', {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ clientSecret: 'cs_other_session_signature' }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        type: 'session_error',
        code: 'session_invalid',
        message: 'Client secret signature mismatch',
      },
    });
  });

  it('returns typed error for expired session on refresh', async () => {
    vi.mocked(sessions.refreshCheckoutSession).mockRejectedValue(
      new SessionError('session_expired', 'Session has expired'),
    );

    const app = createApp();
    const res = await app.request('/v1/session/refresh', {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ clientSecret: 'cs_session_1_signature' }),
    });

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: {
        type: 'session_error',
        code: 'session_expired',
        message: 'Session has expired',
      },
    });
  });

  it('refreshes a checkout session', async () => {
    vi.mocked(sessions.refreshCheckoutSession).mockResolvedValue({
      sessionId: 'session_1',
      clientSecret: 'cs_session_1_new_signature',
      expiresAt: new Date('2024-01-01T00:30:00.000Z'),
      mode: 'sell',
    });

    const app = createApp();
    const res = await app.request('/v1/session/refresh', {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ clientSecret: 'cs_session_1_signature' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientSecret).toBe('cs_session_1_new_signature');
    expect(body.mode).toBe('sell');
  });
});
