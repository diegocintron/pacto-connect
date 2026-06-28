import { type BridgeHost, createBridgeHost } from '@pacto-connect/core';
import {
  applyCheckoutOptions,
  ELEMENT_TAG,
  type PactoCheckoutElement,
  type PactoCheckoutOptions,
  registerPactoCheckoutElement,
} from './element.js';
import { injectCheckoutStyles } from './styles.js';

/**
 * Embedded-side counterpart to {@link mountFrame}, run by the hosted checkout
 * page *inside* the iframe. It reads its configuration from the URL query
 * string written by `buildFrameSrc`, mounts the `<pacto-checkout>` element, and
 * listens for `checkout:close` from the parent over the secure bridge.
 *
 * The element posts its lifecycle events to `window.parent`; this page only
 * needs to handle inbound parent → child messages.
 */

export interface FramePageHandle {
  element: PactoCheckoutElement;
  destroy(): void;
}

export interface BootstrapCheckoutFrameOptions {
  /** Defaults to the current page's query string. */
  search?: string;
  /** Where to mount the element. Defaults to `document.body`. */
  target?: HTMLElement;
}

function parseOptions(params: URLSearchParams, parentOrigin: string): PactoCheckoutOptions {
  const mode = params.get('mode');
  return {
    publishableKey: params.get('publishableKey') ?? '',
    gatewayUrl: params.get('gatewayUrl') ?? undefined,
    listingId: params.get('listingId') ?? undefined,
    sessionId: params.get('sessionId') ?? undefined,
    clientSecret: params.get('clientSecret') ?? undefined,
    sessionExpiresAt: params.get('sessionExpiresAt') ?? undefined,
    mode: mode === 'buy' || mode === 'sell' ? mode : undefined,
    testMode: params.get('testMode') === 'true',
    // Only the parent that opened this frame may exchange bridge messages.
    allowedOrigins: [parentOrigin],
  };
}

export function bootstrapCheckoutFrame(
  options: BootstrapCheckoutFrameOptions = {},
): FramePageHandle {
  registerPactoCheckoutElement();
  injectCheckoutStyles();

  const params = new URLSearchParams(options.search ?? window.location.search);
  const parentOrigin = params.get('parentOrigin');
  if (!parentOrigin) {
    throw new Error('[pacto-connect] parentOrigin query parameter is required for frame embed');
  }

  const checkoutOptions = parseOptions(params, parentOrigin);
  if (!checkoutOptions.publishableKey) {
    throw new Error('[pacto-connect] publishableKey query parameter is required for frame embed');
  }

  const target = options.target ?? document.body;
  const element = document.createElement(ELEMENT_TAG) as PactoCheckoutElement;
  applyCheckoutOptions(element, checkoutOptions);
  target.append(element);
  element.open();

  const host: BridgeHost = createBridgeHost({
    allowedOrigins: [parentOrigin],
    onMessage: (message, event) => {
      // Trust only the window that embedded us.
      if (event.source !== window.parent) {
        return;
      }
      if (message.type === 'checkout:close') {
        element.close();
      }
    },
  });

  return {
    element,
    destroy(): void {
      host.close();
      element.close();
      element.remove();
    },
  };
}
