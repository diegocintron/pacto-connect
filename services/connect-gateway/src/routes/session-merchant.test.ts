import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../merchants.js', () => ({ findActiveMerchant: vi.fn() }));
vi.mock('../sessions.js', () => ({
  createCheckoutSession: vi.fn(),
  refreshCheckoutSession: vi.fn(),
}));
vi.mock('../middleware/idempotency.js', () => ({
  idempotency: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { findActiveMerchant } from '../merchants.js';
import { createCheckoutSession } from '../sessions.js';
import { sessionRoutes } from './session.js';

const apiKey = { id: 'key_1' } as ApiKey;

// Hono `.request` third arg does not reliably seed context vars; use a wrapper app instead.
function app() {
  const a = new Hono<{ Variables: { apiKey: ApiKey } }>();
  a.use('*', async (c, next) => {
    c.set('apiKey', apiKey);
    await next();
  });
  a.route('/v1/session', sessionRoutes);
  return a;
}

describe('session route merchant validation', () => {
  beforeEach(() => {
    vi.mocked(findActiveMerchant).mockReset();
    vi.mocked(createCheckoutSession).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a merchantId not owned by the key', async () => {
    vi.mocked(findActiveMerchant).mockResolvedValue(null);
    const res = await app().request('/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'buy', listingId: 'lst_1', merchantId: 'mrc_x' }),
    });
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('passes merchantId through when valid', async () => {
    vi.mocked(findActiveMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(createCheckoutSession).mockResolvedValue({
      sessionId: 's1',
      clientSecret: 'cs_x',
      expiresAt: new Date(),
      mode: 'buy',
      merchantId: 'mrc_1',
    } as never);
    const res = await app().request('/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'buy', listingId: 'lst_1', merchantId: 'mrc_1' }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(createCheckoutSession).mock.calls[0]![0].merchantId).toBe('mrc_1');
  });
});
