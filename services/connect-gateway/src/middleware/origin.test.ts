import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../keys.js', async () => {
  const actual = await vi.importActual<typeof import('../keys.js')>('../keys.js');
  return {
    ...actual,
    findActiveApiKeyByPublishableKey: vi.fn(),
  };
});

import * as keys from '../keys.js';
import { originValidation, PUBLISHABLE_KEY_HEADER } from './origin.js';

const apiKey: ApiKey = {
  id: 'key_1',
  publishableKey: 'pk_test_k',
  secretKeyHash: 'h',
  secretLast4: 'abcd',
  mode: 'test',
  allowedOrigins: ['https://*.example.com'],
  status: 'active',
  label: null,
  quoteSpreadBps: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  rotatedFromId: null,
  graceExpiresAt: null,
};

function appWithMiddleware() {
  const app = new Hono();
  app.use('*', originValidation);
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('originValidation', () => {
  beforeEach(() => {
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockReset();
    vi.mocked(keys.findActiveApiKeyByPublishableKey).mockResolvedValue(apiKey);
  });

  const headers = (extra: Record<string, string>) => ({
    [PUBLISHABLE_KEY_HEADER]: 'pk_test_k',
    ...extra,
  });

  it('allows a request whose Origin matches a wildcard pattern', async () => {
    const res = await appWithMiddleware().request('/', {
      headers: headers({ Origin: 'https://app.example.com' }),
    });
    expect(res.status).toBe(200);
  });

  it('falls back to Referer when Origin is absent', async () => {
    const res = await appWithMiddleware().request('/', {
      headers: headers({ Referer: 'https://app.example.com/checkout?x=1' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed Origin with invalid_origin', async () => {
    const res = await appWithMiddleware().request('/', {
      headers: headers({ Origin: 'not-a-real-origin' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.any(String), code: 'invalid_origin' });
  });

  it('rejects when neither Origin nor Referer is present', async () => {
    const res = await appWithMiddleware().request('/', { headers: headers({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('origin_required');
  });

  it('rejects a well-formed but disallowed origin with origin_not_allowed', async () => {
    const res = await appWithMiddleware().request('/', {
      headers: headers({ Origin: 'https://evil.com' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('origin_not_allowed');
  });

  it('rejects a malformed Referer when Origin is absent', async () => {
    const res = await appWithMiddleware().request('/', {
      headers: headers({ Referer: 'not-a-real-referer' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('invalid_origin');
  });
});
