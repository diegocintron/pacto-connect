import { PACTO_BRIDGE_SOURCE, PACTO_BRIDGE_VERSION } from '@pacto-connect/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapCheckoutFrame } from './frame-page';

const parentOrigin = 'https://shop.example'; // matches the vitest jsdom url

describe('bootstrapCheckoutFrame', () => {
  beforeEach(() => {
    // Keep the flow pending so the overlay stays mounted without network.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function search(params: Record<string, string>): string {
    return `?${new URLSearchParams(params).toString()}`;
  }

  it('requires a parentOrigin parameter', () => {
    expect(() =>
      bootstrapCheckoutFrame({ search: search({ publishableKey: 'pk_test_123' }) }),
    ).toThrow(/parentOrigin/);
  });

  it('requires a publishableKey parameter', () => {
    expect(() => bootstrapCheckoutFrame({ search: search({ parentOrigin }) })).toThrow(
      /publishableKey/,
    );
  });

  it('mounts an open pacto-checkout element from query params', () => {
    const handle = bootstrapCheckoutFrame({
      search: search({ publishableKey: 'pk_test_123', listingId: 'lst_1', parentOrigin }),
    });

    expect(handle.element.isConnected).toBe(true);
    expect(handle.element.hasAttribute('open')).toBe(true);
    expect(handle.element.getAttribute('publishable-key')).toBe('pk_test_123');

    handle.destroy();
  });

  it('closes the element when the parent posts checkout:close', () => {
    const handle = bootstrapCheckoutFrame({
      search: search({ publishableKey: 'pk_test_123', parentOrigin }),
    });
    expect(handle.element.hasAttribute('open')).toBe(true);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: parentOrigin,
        source: window.parent,
        data: {
          v: PACTO_BRIDGE_VERSION,
          source: PACTO_BRIDGE_SOURCE,
          message: { type: 'checkout:close', payload: {} },
        },
      }),
    );

    expect(handle.element.hasAttribute('open')).toBe(false);
    expect(handle.element.childElementCount).toBe(0);

    handle.destroy();
  });
});
