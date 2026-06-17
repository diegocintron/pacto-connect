import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  errorFromResponse,
  PactoApiError,
  PactoAuthError,
  PactoEscrowError,
  PactoRateLimitError,
} from './errors.js';
import { IDEMPOTENCY_KEY_HEADER, request } from './http.js';

const gatewayUrl = 'https://gateway.example';
const publishableKey = 'pk_test_123';
const clientSecret = 'cs_session_1.signature';

function mockFetchResponse(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe('errorFromResponse', () => {
  it('maps 401 to PactoAuthError', () => {
    const error = errorFromResponse(
      401,
      { error: { code: 'unauthorized', message: 'nope' } },
      {
        path: '/v1/listings',
      },
    );
    expect(error).toBeInstanceOf(PactoAuthError);
  });

  it('maps 403 to PactoAuthError', () => {
    const error = errorFromResponse(
      403,
      { error: { code: 'forbidden', message: 'nope' } },
      {
        path: '/v1/listings',
      },
    );
    expect(error).toBeInstanceOf(PactoAuthError);
  });

  it('maps 429 to PactoRateLimitError with retryAfter', () => {
    const headers = new Headers({ 'Retry-After': '2' });
    const error = errorFromResponse(
      429,
      { error: { code: 'rate_limited', message: 'slow down' } },
      { path: '/v1/quotes' },
      headers,
    );
    expect(error).toBeInstanceOf(PactoRateLimitError);
    expect((error as PactoRateLimitError).retryAfter).toBe(2000);
  });

  it('maps escrow errors to PactoEscrowError', () => {
    const error = errorFromResponse(
      400,
      { error: { type: 'escrow_error', code: 'invalid_state', message: 'bad escrow' } },
      { path: '/v1/escrows', resource: 'escrow' },
    );
    expect(error).toBeInstanceOf(PactoEscrowError);
  });

  it('maps other errors to PactoApiError', () => {
    const error = errorFromResponse(
      400,
      { error: { code: 'bad_request', message: 'invalid' } },
      {
        path: '/v1/listings',
      },
    );
    expect(error).toBeInstanceOf(PactoApiError);
  });
});

describe('http request', () => {
  const sleep = vi.fn(async () => {});

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'idem-key-123'),
    });
    sleep.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send Idempotency-Key on GET requests', async () => {
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(200, { listings: [] }) as Response);

    await request(
      { gatewayUrl, publishableKey, clientSecret, sleep },
      { method: 'GET', path: '/v1/listings' },
    );

    const firstCall = vi.mocked(fetch).mock.calls[0];
    const options = firstCall?.[1];
    const headers = options?.headers as Record<string, string>;
    expect(headers[IDEMPOTENCY_KEY_HEADER]).toBeUndefined();
  });

  it('reuses the same Idempotency-Key across retries', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        mockFetchResponse(500, { error: { code: 'server_error', message: 'fail' } }) as Response,
      )
      .mockResolvedValueOnce(mockFetchResponse(200, { escrow: { id: 'escrow_1' } }) as Response);

    await request(
      { gatewayUrl, publishableKey, clientSecret, maxRetries: 1, sleep },
      {
        method: 'POST',
        path: '/v1/escrows',
        body: { quoteId: 'quote_1' },
        idempotent: true,
        resource: 'escrow',
      },
    );

    const firstCall = vi.mocked(fetch).mock.calls[0];
    const secondCall = vi.mocked(fetch).mock.calls[1];
    const firstHeaders = firstCall?.[1]?.headers as Record<string, string>;
    const secondHeaders = secondCall?.[1]?.headers as Record<string, string>;
    expect(firstHeaders[IDEMPOTENCY_KEY_HEADER]).toBe('idem-key-123');
    expect(secondHeaders[IDEMPOTENCY_KEY_HEADER]).toBe('idem-key-123');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-retryable 4xx errors', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(400, { error: { code: 'bad_request', message: 'invalid' } }) as Response,
    );

    await expect(
      request(
        { gatewayUrl, publishableKey, clientSecret, maxRetries: 3, sleep },
        { method: 'POST', path: '/v1/quotes', body: { asset: 'USDC' }, idempotent: true },
      ),
    ).rejects.toBeInstanceOf(PactoApiError);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network failures and eventually throws PactoApiError', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    await expect(
      request(
        { gatewayUrl, publishableKey, clientSecret, maxRetries: 2, sleep },
        { method: 'GET', path: '/v1/listings' },
      ),
    ).rejects.toBeInstanceOf(PactoApiError);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('maps auth errors from the gateway', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse(401, { error: { code: 'unauthorized', message: 'bad token' } }) as Response,
    );

    await expect(
      request(
        { gatewayUrl, publishableKey, clientSecret, sleep },
        { method: 'GET', path: '/v1/listings' },
      ),
    ).rejects.toBeInstanceOf(PactoAuthError);
  });
});
