import { isOriginAllowed } from '@pacto-connect/core';
import { waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ELEMENT_TAG, registerPactoCheckoutElement } from './element';
import { mount, pacto, VERSION } from './index';

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

function encodeSse(block: string): Uint8Array {
  return new TextEncoder().encode(block);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

function createDeferredSseResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  return {
    response: () =>
      ({
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers(),
      }) as Response,
    push: (block: string) => controller.enqueue(encodeSse(block)),
    close: () => {
      try {
        controller.close();
      } catch {
        // Stream may already be closed.
      }
    },
  };
}

function createFetchMock(sse?: ReturnType<typeof createDeferredSseResponse>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

    if (url.includes('/deposit') && method === 'POST') {
      return jsonResponse({ escrow: { ...escrow, status: 'funded' } });
    }

    if (url.includes('/fiat-receipt') && method === 'POST') {
      return jsonResponse({ escrow: { ...escrow, status: 'active' } });
    }

    if (url.includes('/v1/test/escrows/')) {
      return jsonResponse({ escrow: { ...escrow, status: 'released' } });
    }

    if (url.includes('/v1/escrows/events')) {
      if (sse) {
        return sse.response();
      }
      return jsonResponse({});
    }

    return jsonResponse({ error: 'not found' }, 404);
  });
}

describe('@pacto-connect/elements', () => {
  beforeEach(() => {
    registerPactoCheckoutElement();
    document.body.innerHTML = '<div id="checkout-root"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('exposes a version and pacto.mount', () => {
    expect(VERSION).toBe('0.0.0');
    expect(pacto.mount).toBeTypeOf('function');
  });

  it('registers the pacto-checkout custom element', () => {
    expect(customElements.get(ELEMENT_TAG)).toBeDefined();
  });

  it('completes buy flow via pacto.mount and posts bridge events', async () => {
    const onComplete = vi.fn();
    const postMessage = vi.spyOn(window, 'postMessage');
    const sse = createDeferredSseResponse();
    vi.stubGlobal('fetch', createFetchMock(sse));

    const handle = mount('#checkout-root', {
      publishableKey,
      gatewayUrl,
      listingId,
      testMode: true,
      allowedOrigins: ['https://shop.example'],
      onComplete,
    });

    await waitFor(() => {
      expect(document.querySelector('[data-testid="deposit-step"]')).toBeTruthy();
    });

    expect(document.querySelector('[data-testid="checkout-test-banner"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="checkout-test-banner"]')?.textContent).toContain(
      'TEST MODE',
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'pacto-connect',
        message: expect.objectContaining({
          type: 'checkout:ready',
          payload: { sessionId: 'sess_1' },
        }),
      }),
      'https://shop.example',
    );

    const user = userEvent.setup();
    await user.click(
      document.querySelector('[data-testid="deposit-step"] button') as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="receipt-form"]')).toBeTruthy();
    });

    const referenceInput = document.querySelector(
      '[aria-label="Payment reference"]',
    ) as HTMLInputElement;
    await user.type(referenceInput, 'REF-123');
    await user.click(
      document.querySelector(
        '[data-testid="receipt-form"] button[type="submit"]',
      ) as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="tracking-step"]')).toBeTruthy();
    });

    sse.push(
      'id: cursor-1\nevent: released\ndata: {"escrowId":"esc_1","occurredAt":"2024-01-01T00:10:00.000Z"}\n\n',
    );
    sse.close();

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));
    });

    expect(document.querySelector('[data-testid="checkout-success"]')).toBeTruthy();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'pacto-connect',
        message: expect.objectContaining({
          type: 'checkout:complete',
          payload: { escrow: expect.objectContaining({ id: 'esc_1' }) },
        }),
      }),
      'https://shop.example',
    );

    handle.destroy();
    postMessage.mockRestore();
  });

  it('works as a plain HTML custom element with session-id', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const element = document.createElement(ELEMENT_TAG);
    element.setAttribute('publishable-key', publishableKey);
    element.setAttribute('gateway-url', gatewayUrl);
    element.setAttribute('listing-id', listingId);
    element.setAttribute('session-id', 'sess_existing');
    element.setAttribute('client-secret', 'cs_sess_existing.sig');
    element.setAttribute('open', '');

    document.body.append(element);

    await waitFor(() => {
      expect(document.querySelector('[data-testid="deposit-step"]')).toBeTruthy();
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/session'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects bridge messages from unauthorized origins', () => {
    expect(isOriginAllowed('https://evil.example', ['https://shop.example'])).toBe(false);
  });
});
