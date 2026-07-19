import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../idempotency.js', () => ({
  computeRequestHash: vi.fn(() => 'hash_1'),
  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
}));

import { beginIdempotency, completeIdempotency } from '../idempotency.js';
import { idempotency } from './idempotency.js';

function buildApp() {
  const app = new Hono<{ Variables: { apiKey: ApiKey } }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', { id: 'key_1' } as ApiKey);
    await next();
  });
  const handler = vi.fn(async (c) => c.json({ created: true }, 201));
  app.post('/thing', idempotency(), (c) => handler(c));
  return { app, handler };
}

describe('idempotency middleware', () => {
  beforeEach(() => {
    vi.mocked(beginIdempotency).mockReset();
    vi.mocked(completeIdempotency).mockReset();
  });

  it('passes through when no Idempotency-Key header is present', async () => {
    const { app, handler } = buildApp();
    const res = await app.request('/thing', { method: 'POST', body: '{}' });
    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledOnce();
    expect(beginIdempotency).not.toHaveBeenCalled();
  });

  it('runs the handler and stores the response on proceed', async () => {
    vi.mocked(beginIdempotency).mockResolvedValue({ kind: 'proceed' });
    const { app, handler } = buildApp();
    const res = await app.request('/thing', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem_1' },
      body: '{}',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });
    expect(handler).toHaveBeenCalledOnce();
    expect(completeIdempotency).toHaveBeenCalledWith({
      apiKeyId: 'key_1',
      key: 'idem_1',
      statusCode: 201,
      responseBody: '{"created":true}',
    });
  });

  it('replays the stored response without running the handler', async () => {
    vi.mocked(beginIdempotency).mockResolvedValue({
      kind: 'replay',
      statusCode: 201,
      responseBody: '{"created":true}',
    });
    const { app, handler } = buildApp();
    const res = await app.request('/thing', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem_1' },
      body: '{}',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 409 idempotency_key_reuse on a body mismatch', async () => {
    vi.mocked(beginIdempotency).mockResolvedValue({ kind: 'mismatch' });
    const { app, handler } = buildApp();
    const res = await app.request('/thing', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem_1' },
      body: '{}',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('idempotency_key_reuse');
    expect(handler).not.toHaveBeenCalled();
  });
});
