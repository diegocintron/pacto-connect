import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDEMPOTENCY_KEY_HEADER, PUBLISHABLE_KEY_HEADER } from './http.js';
import { createApiClient } from './resources.js';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
const clientSecret = 'cs_session_1.signature';

const escrow = {
  id: 'esc_1',
  quoteId: 'quo_1',
  status: 'disputed' as const,
  amount: '100',
  asset: 'USDC',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const subscription = {
  id: 'sub_1',
  status: 'active' as const,
  from: 'USD',
  to: 'CRC',
  amount: 100,
  asset: 'USDC',
  interval: 'month' as const,
  payerRef: null,
  nextChargeAt: '2024-02-01T00:00:00.000Z',
  canceledAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  };
}

describe('PactoApiClient test namespace', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'idem-key-123'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const clientOptions = {
    gatewayUrl,
    publishableKey,
    clientSecret,
  };

  it('forceDispute posts to /v1/test/escrows/:id/dispute with reason body', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { escrow }) as Response);

    const api = createApiClient(clientOptions);
    const response = await api.test.forceDispute('esc_1', { reason: 'buyer_claim' });

    expect(response.escrow).toEqual(escrow);
    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/test/escrows/esc_1/dispute`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'buyer_claim' }),
      }),
    );

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${clientSecret}`);
    expect(headers[PUBLISHABLE_KEY_HEADER]).toBe(publishableKey);
    expect(headers[IDEMPOTENCY_KEY_HEADER]).toBe('idem-key-123');
  });

  it('forceDispute omits body when reason is not provided', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { escrow }) as Response);

    const api = createApiClient(clientOptions);
    await api.test.forceDispute('esc_1');

    const options = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(options?.body).toBeUndefined();
  });

  it('forceTimeout posts to /v1/test/escrows/:id/timeout', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { escrow }) as Response);

    const api = createApiClient(clientOptions);
    await api.test.forceTimeout('esc_1');

    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/test/escrows/esc_1/timeout`,
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      }),
    );
  });

  it('forceRelease posts to /v1/test/escrows/:id/release', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { escrow }) as Response);

    const api = createApiClient(clientOptions);
    await api.test.forceRelease('esc_1');

    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/test/escrows/esc_1/release`,
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      }),
    );
  });

  it('advanceSubscription posts to /v1/test/subscriptions/:id/advance', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { result: { ok: true } }) as Response);

    const api = createApiClient(clientOptions);
    await api.test.advanceSubscription('sub_1');

    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/test/subscriptions/sub_1/advance`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers[IDEMPOTENCY_KEY_HEADER]).toBe('idem-key-123');
  });

  it('failNextCharge posts to /v1/test/subscriptions/:id/fail-next', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { ok: true }) as Response);

    const api = createApiClient(clientOptions);
    const response = await api.test.failNextCharge('sub_1');

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/test/subscriptions/sub_1/fail-next`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});

describe('PactoApiClient subscriptions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'idem-key-123'),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const clientOptions = {
    gatewayUrl,
    publishableKey,
    clientSecret,
  };

  it('create posts to /v1/subscriptions with the params', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { subscription }) as Response);

    const api = createApiClient(clientOptions);
    const response = await api.subscriptions.create({
      from: 'USD',
      to: 'CRC',
      amount: 100,
      interval: 'month',
    });

    expect(response.subscription).toEqual(subscription);
    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/subscriptions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ from: 'USD', to: 'CRC', amount: 100, interval: 'month' }),
      }),
    );

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${clientSecret}`);
    expect(headers[PUBLISHABLE_KEY_HEADER]).toBe(publishableKey);
    expect(headers[IDEMPOTENCY_KEY_HEADER]).toBe('idem-key-123');
  });

  it('retrieve gets /v1/subscriptions/:id', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { subscription }) as Response);

    const api = createApiClient(clientOptions);
    const response = await api.subscriptions.retrieve('sub_1');

    expect(response.subscription).toEqual(subscription);
    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/subscriptions/sub_1`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('list gets /v1/subscriptions', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(200, { subscriptions: [subscription] }) as Response,
    );

    const api = createApiClient(clientOptions);
    const response = await api.subscriptions.list();

    expect(response.subscriptions).toEqual([subscription]);
    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/subscriptions`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('cancel posts to /v1/subscriptions/:id/cancel', async () => {
    const canceled = { ...subscription, status: 'canceled' as const, canceledAt: '2024-03-01T00:00:00.000Z' };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { subscription: canceled }) as Response);

    const api = createApiClient(clientOptions);
    const response = await api.subscriptions.cancel('sub_1');

    expect(response.subscription.status).toBe('canceled');
    expect(fetch).toHaveBeenCalledWith(
      `${gatewayUrl}/v1/subscriptions/sub_1/cancel`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers[IDEMPOTENCY_KEY_HEADER]).toBe('idem-key-123');
  });
});
