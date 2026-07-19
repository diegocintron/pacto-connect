import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const { WebhookValidationError } = vi.hoisted(() => {
  class WebhookValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WebhookValidationError';
    }
  }

  return { WebhookValidationError };
});

vi.mock('../webhooks/endpoints.js', () => ({
  registerEndpoint: vi.fn(),
  listEndpoints: vi.fn(),
  getEndpoint: vi.fn(),
  setEndpointStatus: vi.fn(),
  deleteEndpoint: vi.fn(),
  verifyEndpoint: vi.fn(),
  WebhookValidationError,
}));

vi.mock('../webhooks/delivery.js', () => ({
  listDeliveries: vi.fn(),
  listDeadLetterDeliveries: vi.fn(),
  requeueDelivery: vi.fn(),
}));

vi.mock('../db.js', () => ({
  prisma: {},
}));

vi.mock('../merchants.js', () => ({ findActiveMerchant: vi.fn() }));

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

import { findActiveMerchant } from '../merchants.js';
import * as delivery from '../webhooks/delivery.js';
import * as endpoints from '../webhooks/endpoints.js';

describe('admin webhook routes', () => {
  beforeEach(() => {
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
    vi.mocked(endpoints.registerEndpoint).mockReset();
    vi.mocked(endpoints.verifyEndpoint).mockReset();
    vi.mocked(delivery.listDeadLetterDeliveries).mockReset();
    vi.mocked(delivery.requeueDelivery).mockReset();
    vi.mocked(findActiveMerchant).mockReset();
  });

  it('rejects webhook admin requests without token', async () => {
    const app = createApp();
    const res = await app.request('/admin/webhooks');

    expect(res.status).toBe(401);
  });

  it('returns 400 when apiKeyId is missing on create', async () => {
    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com/webhook' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'apiKeyId is required' });
  });

  it('creates a webhook endpoint and returns the secret once', async () => {
    vi.mocked(endpoints.registerEndpoint).mockResolvedValue({
      id: 'wh_1',
      apiKeyId: 'key_1',
      merchantId: null,
      url: 'https://example.com/webhook',
      enabledEvents: ['checkout.session.created'],
      status: 'enabled',
      verified: false,
      description: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      secret: 'whsec_testsecret',
    });

    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKeyId: 'key_1',
        url: 'https://example.com/webhook',
        enabledEvents: ['checkout.session.created'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.endpoint.secret).toBe('whsec_testsecret');
  });

  it('returns 400 when registerEndpoint throws WebhookValidationError', async () => {
    vi.mocked(endpoints.registerEndpoint).mockRejectedValue(
      new endpoints.WebhookValidationError('enabledEvents must be a non-empty array'),
    );

    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKeyId: 'key_1',
        url: 'https://example.com/webhook',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'enabledEvents must be a non-empty array',
    });
  });

  it('returns 400 when merchantId is not a non-empty string', async () => {
    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKeyId: 'key_1',
        url: 'https://example.com/webhook',
        merchantId: '',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'merchantId must be a non-empty string' });
    expect(findActiveMerchant).not.toHaveBeenCalled();
    expect(endpoints.registerEndpoint).not.toHaveBeenCalled();
  });

  it('returns 400 when merchantId is unknown, disabled, or not owned by the key', async () => {
    vi.mocked(findActiveMerchant).mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKeyId: 'key_1',
        url: 'https://example.com/webhook',
        merchantId: 'mrc_x',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'merchantId is unknown, disabled, or not owned by this key',
    });
    expect(findActiveMerchant).toHaveBeenCalledWith('key_1', 'mrc_x');
    expect(endpoints.registerEndpoint).not.toHaveBeenCalled();
  });

  it('creates a webhook endpoint scoped to a valid merchantId', async () => {
    vi.mocked(findActiveMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(endpoints.registerEndpoint).mockResolvedValue({
      id: 'wh_1',
      apiKeyId: 'key_1',
      merchantId: 'mrc_1',
      url: 'https://example.com/webhook',
      enabledEvents: ['checkout.session.created'],
      status: 'enabled',
      verified: false,
      description: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      secret: 'whsec_testsecret',
    });

    const app = createApp();
    const res = await app.request('/admin/webhooks', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKeyId: 'key_1',
        url: 'https://example.com/webhook',
        enabledEvents: ['checkout.session.created'],
        merchantId: 'mrc_1',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.endpoint.merchantId).toBe('mrc_1');
    expect(findActiveMerchant).toHaveBeenCalledWith('key_1', 'mrc_1');
    expect(endpoints.registerEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'mrc_1' }),
    );
  });

  it('lists dead-letter deliveries', async () => {
    vi.mocked(delivery.listDeadLetterDeliveries).mockResolvedValue([
      {
        id: 'del_1',
        endpointId: 'wh_1',
        eventId: 'evt_1',
        eventType: 'checkout.session.created',
        status: 'dead',
        attempts: 5,
        maxAttempts: 5,
        nextAttemptAt: new Date('2024-01-01T00:00:00.000Z'),
        lastStatusCode: 500,
        lastError: 'delivery failed',
        deliveredAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);

    const app = createApp();
    const res = await app.request('/admin/webhooks/dlq', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.deliveries[0].id).toBe('del_1');
  });

  it('returns 404 when retrying an unknown delivery', async () => {
    vi.mocked(delivery.requeueDelivery).mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/admin/webhooks/deliveries/del_missing/retry', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'delivery not found' });
  });

  it('verifies a webhook endpoint', async () => {
    vi.mocked(endpoints.verifyEndpoint).mockResolvedValue({ verified: true });

    const app = createApp();
    const res = await app.request('/admin/webhooks/some-id/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { verified: true } });
  });
});
