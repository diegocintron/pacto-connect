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

vi.mock('./db.js', () => ({
  prisma: {},
}));

import * as keys from './keys.js';

describe('origin validation middleware', () => {
  beforeEach(() => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  });

  it('rejects requests without a publishable key', async () => {
    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: { Origin: 'https://allowed.example' },
    });

    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid origin', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: {
        Origin: 'https://evil.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin not allowed for this key' });
  });

  it('rejects requests without an origin header', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: { [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'origin header required' });
  });

  it('rejects revoked or unknown keys', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: 'pk_test_revoked',
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'invalid or revoked publishable key' });
  });

  it('allows valid origin and sets strict CORS headers', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
      },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('handles CORS preflight for allowed origins', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/session', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
  });

  it('does not require origin validation on /health', async () => {
    const app = createApp();
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'connect-gateway' });
  });
});

describe('admin routes', () => {
  beforeEach(() => {
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  });

  it('rejects admin requests without token', async () => {
    const app = createApp();
    const res = await app.request('/admin/keys');

    expect(res.status).toBe(401);
  });

  it('lists keys without exposing secret material', async () => {
    vi.mocked(keys.listApiKeys).mockResolvedValue([
      {
        id: 'key_1',
        publishableKey: 'pk_test_mockkey',
        secretLast4: 'abcd',
        mode: 'test',
        allowedOrigins: ['https://allowed.example'],
        status: 'active',
        label: null,
        quoteSpreadBps: 0,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);

    const app = createApp();
    const res = await app.request('/admin/keys', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys[0]).not.toHaveProperty('secretKey');
    expect(body.keys[0]).not.toHaveProperty('secretKeyHash');
    expect(body.keys[0].secretLast4).toBe('abcd');
  });

  it('returns secret key only once on create', async () => {
    vi.mocked(keys.createApiKey).mockResolvedValue({
      id: 'key_new',
      publishableKey: 'pk_test_new',
      secretKey: 'sk_test_newsecret',
      secretLast4: 'cret',
      mode: 'test',
      allowedOrigins: ['https://allowed.example'],
      status: 'active',
      label: null,
      quoteSpreadBps: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = createApp();
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'test',
        allowedOrigins: ['https://allowed.example'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key.secretKey).toMatch(/^sk_test_/);
    expect(body.key.publishableKey).toMatch(/^pk_test_/);
  });
});

describe('quote route', () => {
  beforeEach(() => {
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
  });

  it('returns 200 with a quote for a valid request body', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/quote', {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote.token).toEqual(expect.any(String));
    expect(body.quote.token.length).toBeGreaterThan(0);
    expect(body.quote.baseRate).toBe(510);
    expect(body.quote.effectiveRate).toBe(510);
    expect(body.quote.expiresAt).toBeDefined();
  });

  it('applies the merchant spread', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue({
      ...mockApiKey,
      quoteSpreadBps: 100,
    });

    const app = createApp();
    const res = await app.request('/v1/quote', {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote.effectiveRate).toBe(504.9);
  });

  it('returns 400 for an unsupported currency', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/quote', {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'EUR', to: 'CRC', amount: 100 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('unsupported_currency');
  });

  it('returns 400 for amount <= 0', async () => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);

    const app = createApp();
    const res = await app.request('/v1/quote', {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 0 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_request');
  });
});

describe('keys service hashing', () => {
  it('never stores plaintext secrets in hash output', async () => {
    const { hashSecretKey } = await vi.importActual<typeof import('./keys.js')>('./keys.js');
    const secret = 'sk_test_supersecretvalue';
    const hash = hashSecretKey(secret);

    expect(hash).not.toContain(secret);
    expect(hash).toHaveLength(64);
  });
});

describe('rate limiting', () => {
  beforeEach(() => {
    process.env.GATEWAY_SIGNING_SECRET = 'test-signing-secret';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX = '2';
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(mockApiKey);
  });

  it('returns 429 with Retry-After once the per-key limit is exceeded', async () => {
    const app = createApp();
    const headers = {
      Origin: 'https://allowed.example',
      [PUBLISHABLE_KEY_HEADER]: mockApiKey.publishableKey,
      'Content-Type': 'application/json',
    };
    const send = () =>
      app.request('/v1/quote', {
        method: 'POST',
        headers,
        body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100 }),
      });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    const body = await limited.json();
    expect(body.error.code).toBe('too_many_requests');
  });
});
