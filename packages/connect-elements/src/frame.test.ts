import { PACTO_BRIDGE_SOURCE, PACTO_BRIDGE_VERSION } from '@pacto-connect/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAME_SANDBOX, mountFrame } from './frame';

const frameUrl = 'https://checkout.pacto.example/embed';
const frameOrigin = 'https://checkout.pacto.example';
const publishableKey = 'pk_test_123';

const escrow = {
  id: 'esc_1',
  quoteId: 'quo_1',
  status: 'released' as const,
  amount: '100',
  asset: 'USDC',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function envelope(message: unknown) {
  return { v: PACTO_BRIDGE_VERSION, source: PACTO_BRIDGE_SOURCE, message };
}

function dispatchFromFrame(iframe: HTMLIFrameElement, origin: string, message: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: iframe.contentWindow,
      data: envelope(message),
    }),
  );
}

describe('mountFrame', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="checkout-root"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('throws without a publishable key', () => {
    expect(() => mountFrame('#checkout-root', { url: frameUrl, publishableKey: '' })).toThrow(
      /publishableKey is required/,
    );
  });

  it('creates a sandboxed iframe with config encoded in the src', () => {
    const handle = mountFrame('#checkout-root', {
      url: frameUrl,
      publishableKey,
      listingId: 'lst_1',
      mode: 'buy',
      testMode: true,
    });

    const { iframe } = handle;
    expect(iframe.parentElement?.id).toBe('checkout-root');
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');

    const src = new URL(iframe.src);
    expect(src.origin).toBe(frameOrigin);
    expect(src.searchParams.get('publishableKey')).toBe(publishableKey);
    expect(src.searchParams.get('listingId')).toBe('lst_1');
    expect(src.searchParams.get('mode')).toBe('buy');
    expect(src.searchParams.get('testMode')).toBe('true');
    expect(src.searchParams.get('parentOrigin')).toBe(window.location.origin);

    handle.destroy();
  });

  it('surfaces lifecycle events from the iframe origin', () => {
    const onReady = vi.fn();
    const onComplete = vi.fn();
    const handle = mountFrame('#checkout-root', {
      url: frameUrl,
      publishableKey,
      onReady,
      onComplete,
    });

    dispatchFromFrame(handle.iframe, frameOrigin, {
      type: 'checkout:ready',
      payload: { sessionId: 'sess_1' },
    });
    dispatchFromFrame(handle.iframe, frameOrigin, {
      type: 'checkout:complete',
      payload: { escrow },
    });

    expect(onReady).toHaveBeenCalledWith('sess_1');
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'esc_1' }));

    handle.destroy();
  });

  it('rejects messages from unauthorized origins', () => {
    const onComplete = vi.fn();
    const handle = mountFrame('#checkout-root', { url: frameUrl, publishableKey, onComplete });

    dispatchFromFrame(handle.iframe, 'https://evil.example', {
      type: 'checkout:complete',
      payload: { escrow },
    });

    expect(onComplete).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('rejects messages whose source is not the iframe window', () => {
    const onComplete = vi.fn();
    const handle = mountFrame('#checkout-root', { url: frameUrl, publishableKey, onComplete });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: frameOrigin,
        source: window,
        data: envelope({ type: 'checkout:complete', payload: { escrow } }),
      }),
    );

    expect(onComplete).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('posts checkout:close into the iframe on close()', () => {
    const handle = mountFrame('#checkout-root', { url: frameUrl, publishableKey });
    const postMessage = vi.spyOn(handle.iframe.contentWindow as Window, 'postMessage');

    handle.close();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: PACTO_BRIDGE_SOURCE,
        message: { type: 'checkout:close', payload: {} },
      }),
      frameOrigin,
    );

    postMessage.mockRestore();
    handle.destroy();
  });

  it('applies exactly the documented sandbox tokens and payment permission', () => {
    const handle = mountFrame('#checkout-root', {
      url: frameUrl,
      publishableKey: 'pk_test_x',
    });
    expect(handle.iframe.getAttribute('sandbox')).toBe(FRAME_SANDBOX);
    expect(handle.iframe.getAttribute('allow')).toBe('payment');
    expect(FRAME_SANDBOX).toBe('allow-scripts allow-forms allow-same-origin allow-popups');
    handle.destroy();
  });

  it('removes the iframe and stops listening after destroy()', () => {
    const onComplete = vi.fn();
    const handle = mountFrame('#checkout-root', { url: frameUrl, publishableKey, onComplete });
    const { iframe } = handle;

    handle.destroy();
    expect(iframe.parentElement).toBeNull();

    dispatchFromFrame(iframe, frameOrigin, {
      type: 'checkout:complete',
      payload: { escrow },
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
