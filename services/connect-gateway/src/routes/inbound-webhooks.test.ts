import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../webhooks/nonce.js', () => ({ consumeNonce: vi.fn(), releaseNonce: vi.fn() }));
vi.mock('../webhooks/delivery.js', () => ({ dispatchEvent: vi.fn() }));

import { Hono } from 'hono';
import { dispatchEvent } from '../webhooks/delivery.js';
import { consumeNonce, releaseNonce } from '../webhooks/nonce.js';
import { signPayload, WEBHOOK_SIGNATURE_HEADER } from '../webhooks/signature.js';
import { inboundWebhookRoutes } from './inbound-webhooks.js';

const SECRET = 'whsec_inbound_secret';
const NOW = 1_700_000_000;

function buildApp() {
  const app = new Hono();
  app.route('/v1/webhooks/inbound', inboundWebhookRoutes);
  return app;
}

function signedRequest(body: string, opts?: { nonce?: string; timestamp?: number }) {
  const timestamp = opts?.timestamp ?? NOW;
  const header = signPayload(body, SECRET, timestamp, opts?.nonce ?? 'nonce_1');
  return {
    method: 'POST',
    headers: { [WEBHOOK_SIGNATURE_HEADER]: header, 'Content-Type': 'application/json' },
    body,
  };
}

const validBody = JSON.stringify({
  id: 'up_evt_1',
  apiKeyId: 'key_1',
  type: 'escrow.created',
  data: { escrowId: 'esc_1' },
});

describe('inbound webhook receiver', () => {
  beforeEach(() => {
    process.env.PACTO_WEBHOOK_SECRET = SECRET;
    process.env.WEBHOOK_REPLAY_TOLERANCE_SECONDS = '300';
    vi.mocked(consumeNonce).mockReset();
    vi.mocked(dispatchEvent).mockReset();
    vi.mocked(releaseNonce).mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a valid signed event and dispatches it once', async () => {
    vi.mocked(consumeNonce).mockResolvedValue(true);
    vi.mocked(dispatchEvent).mockResolvedValue({ eventId: 'evt_1', deliveries: 1 });

    const res = await buildApp().request('/v1/webhooks/inbound', signedRequest(validBody));

    expect(res.status).toBe(200);
    expect(dispatchEvent).toHaveBeenCalledWith({
      apiKeyId: 'key_1',
      type: 'escrow.created',
      data: { escrowId: 'esc_1' },
      sourceEventId: 'up_evt_1',
    });
  });

  it('rejects and logs a payload whose timestamp is outside tolerance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(consumeNonce).mockResolvedValue(true);

    const res = await buildApp().request(
      '/v1/webhooks/inbound',
      signedRequest(validBody, { timestamp: NOW - 10_000 }),
    );

    expect(res.status).toBe(400);
    expect(warn).toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects and logs a replayed nonce', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(consumeNonce).mockResolvedValue(false);

    const res = await buildApp().request('/v1/webhooks/inbound', signedRequest(validBody));

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('replay_detected');
    expect(warn).toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects a signed event with no nonce', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(consumeNonce).mockResolvedValue(true);
    const header = signPayload(validBody, SECRET, NOW); // no nonce
    const res = await buildApp().request('/v1/webhooks/inbound', {
      method: 'POST',
      headers: { [WEBHOOK_SIGNATURE_HEADER]: header, 'Content-Type': 'application/json' },
      body: validBody,
    });
    expect(res.status).toBe(400);
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects a signed body that is the literal null', async () => {
    vi.mocked(consumeNonce).mockResolvedValue(true);

    const res = await buildApp().request('/v1/webhooks/inbound', signedRequest('null'));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_payload');
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('rejects a request with a missing signature header', async () => {
    const res = await buildApp().request('/v1/webhooks/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: validBody,
    });

    expect(res.status).toBe(400);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('returns a shaped 500 when dispatch fails', async () => {
    vi.mocked(consumeNonce).mockResolvedValue(true);
    vi.mocked(dispatchEvent).mockRejectedValue(new Error('boom'));

    const res = await buildApp().request('/v1/webhooks/inbound', signedRequest(validBody));

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('dispatch_failed');
  });

  it('releases the nonce when dispatch fails so a retry can succeed', async () => {
    vi.mocked(consumeNonce).mockResolvedValue(true);
    vi.mocked(dispatchEvent).mockRejectedValue(new Error('boom'));

    const res = await buildApp().request(
      '/v1/webhooks/inbound',
      signedRequest(validBody, { nonce: 'nonce_release_me' }),
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('dispatch_failed');
    expect(releaseNonce).toHaveBeenCalledWith('nonce_release_me');
  });
});
