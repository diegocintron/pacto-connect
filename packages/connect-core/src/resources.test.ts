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
});
