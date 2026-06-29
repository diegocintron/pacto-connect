import { describe, expect, it, vi } from 'vitest';
import { WEBHOOK_SIGNATURE_HEADER } from './signature.js';
import { postSignedWebhook } from './transport.js';

describe('postSignedWebhook', () => {
  it('POSTs with signature header and Content-Type application/json', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    });

    await postSignedWebhook('https://example.com/hook', '{"event":"test"}', 'whsec_test', {
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"event":"test"}');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'User-Agent': 'PactoConnect-Webhooks/1.0',
    });
    expect((init.headers as Record<string, string>)[WEBHOOK_SIGNATURE_HEADER]).toMatch(
      /^t=\d+,v1=[0-9a-f]{64}$/,
    );
  });

  it('returns ok:true with status and bodyText on a 200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"received":true}',
    });

    const result = await postSignedWebhook('https://example.com/hook', '{}', 'whsec_test', {
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      bodyText: '{"received":true}',
    });
  });

  it('returns ok:false with status on a 500 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    });

    const result = await postSignedWebhook('https://example.com/hook', '{}', 'whsec_test', {
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      bodyText: 'internal error',
    });
  });

  it('returns ok:false with error when fetchImpl throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await postSignedWebhook('https://example.com/hook', '{}', 'whsec_test', {
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      error: 'network down',
    });
  });

  it('maps an AbortError to error:timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchImpl = vi.fn().mockRejectedValue(abortError);

    const result = await postSignedWebhook('https://example.com/hook', '{}', 'whsec_test', {
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      error: 'timeout',
    });
  });
});
