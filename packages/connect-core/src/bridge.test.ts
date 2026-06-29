import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBridgeClient,
  createBridgeHost,
  isOriginAllowed,
  isPactoBridgeEnvelope,
  PACTO_BRIDGE_SOURCE,
  PACTO_BRIDGE_VERSION,
} from './bridge';

describe('postMessage bridge', () => {
  it('validates pacto bridge envelopes', () => {
    expect(
      isPactoBridgeEnvelope({
        v: PACTO_BRIDGE_VERSION,
        source: PACTO_BRIDGE_SOURCE,
        message: { type: 'checkout:ready', payload: { sessionId: 'sess_1' } },
      }),
    ).toBe(true);

    expect(isPactoBridgeEnvelope({ v: 1, source: 'other', message: {} })).toBe(false);
    expect(isPactoBridgeEnvelope(null)).toBe(false);
  });

  it('checks allowed origins', () => {
    expect(isOriginAllowed('https://shop.example', ['https://shop.example'])).toBe(true);
    expect(isOriginAllowed('https://evil.example', ['https://shop.example'])).toBe(false);
  });

  it('rejects messages from unauthorized origins on the host', () => {
    const onMessage = vi.fn();
    const host = createBridgeHost({
      allowedOrigins: ['https://allowed.example'],
      onMessage,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: {
          v: PACTO_BRIDGE_VERSION,
          source: PACTO_BRIDGE_SOURCE,
          message: { type: 'checkout:close', payload: {} },
        },
      }),
    );

    expect(onMessage).not.toHaveBeenCalled();
    host.close();
  });

  it('accepts valid messages from allowed origins on the host', () => {
    const onMessage = vi.fn();
    const host = createBridgeHost({
      allowedOrigins: ['https://allowed.example'],
      onMessage,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://allowed.example',
        data: {
          v: PACTO_BRIDGE_VERSION,
          source: PACTO_BRIDGE_SOURCE,
          message: { type: 'checkout:step', payload: { step: 'deposit' } },
        },
      }),
    );

    expect(onMessage).toHaveBeenCalledWith(
      { type: 'checkout:step', payload: { step: 'deposit' } },
      expect.any(MessageEvent),
    );
    host.close();
  });

  it('rejects inbound messages on the client from unauthorized origins', () => {
    const handler = vi.fn();
    const client = createBridgeClient({
      targetOrigin: 'https://parent.example',
      allowedOrigins: ['https://parent.example'],
    });

    const stop = client.listen(handler);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        data: {
          v: PACTO_BRIDGE_VERSION,
          source: PACTO_BRIDGE_SOURCE,
          message: { type: 'checkout:close', payload: {} },
        },
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    stop();
    client.close();
  });
});

describe('CheckoutFlowController', () => {
  const gatewayUrl = 'https://gateway.example';
  const publishableKey = 'pk_test_123';
  const listingId = 'lst_1';

  const listing = {
    id: listingId,
    asset: 'USDC',
    amount: '100',
    price: '5000',
    side: 'buy' as const,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const quote = {
    id: 'quo_1',
    listingId,
    asset: 'USDC',
    amount: '100',
    price: '5000',
    side: 'buy' as const,
    expiresAt: '2024-01-02T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const escrow = {
    id: 'esc_1',
    quoteId: quote.id,
    status: 'pending' as const,
    amount: '100',
    asset: 'USDC',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => body,
    } as Response;
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('/v1/session') && method === 'POST') {
          return jsonResponse({
            sessionId: 'sess_1',
            clientSecret: 'cs_sess_1.sig',
            expiresAt: '2099-01-01T00:00:00.000Z',
            mode: 'buy',
          });
        }

        if (url.includes(`/v1/listings/${listingId}`)) {
          return jsonResponse({ listing });
        }

        if (url.endsWith('/v1/listings')) {
          return jsonResponse({ listings: [listing] });
        }

        if (url.endsWith('/v1/quotes') && method === 'POST') {
          return jsonResponse({ quote });
        }

        if (url.endsWith('/v1/escrows') && method === 'POST') {
          return jsonResponse({ escrow });
        }

        return jsonResponse({ error: 'not found' }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes with listingId and reaches deposit step', async () => {
    const { CheckoutFlowController } = await import('./checkout-flow');
    const controller = new CheckoutFlowController({
      publishableKey,
      gatewayUrl,
      listingId,
    });

    await controller.start();

    expect(controller.getState().step).toBe('deposit');
    expect(controller.getState().escrow?.id).toBe('esc_1');
    controller.destroy();
  });

  it('sets testMode true for pk_test_ publishable keys', async () => {
    const { CheckoutFlowController } = await import('./checkout-flow');
    const controller = new CheckoutFlowController({
      publishableKey: 'pk_test_123',
      gatewayUrl,
      listingId,
    });

    await controller.start();

    expect(controller.getState().testMode).toBe(true);
    controller.destroy();
  });

  it('sets testMode false for pk_live_ publishable keys', async () => {
    const { CheckoutFlowController } = await import('./checkout-flow');
    const controller = new CheckoutFlowController({
      publishableKey: 'pk_live_123',
      gatewayUrl,
      listingId,
    });

    await controller.start();

    expect(controller.getState().testMode).toBe(false);
    controller.destroy();
  });

  it('resumes a pre-created session without calling POST /v1/session', async () => {
    const fetchMock = vi.mocked(fetch);
    const { CheckoutFlowController } = await import('./checkout-flow');
    const controller = new CheckoutFlowController({
      publishableKey,
      gatewayUrl,
      listingId,
      session: {
        sessionId: 'sess_existing',
        clientSecret: 'cs_sess_existing.sig',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        mode: 'buy',
      },
    });

    await controller.start();

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/session'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(controller.getState().step).toBe('deposit');
    controller.destroy();
  });
});
