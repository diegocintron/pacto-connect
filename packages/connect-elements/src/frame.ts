import {
  type BridgeClient,
  type BridgeHost,
  type CheckoutMode,
  createBridgeClient,
  createBridgeHost,
  type Escrow,
  type PactoBridgeMessage,
} from '@pacto-connect/core';
import { resolveTarget } from './mount.js';

/**
 * Host-side iframe embed.
 *
 * `mountFrame` renders the checkout inside a sandboxed cross-origin `<iframe>`
 * pointing at a hosted page that runs `bootstrapCheckoutFrame()`. The two sides
 * talk over the secure postMessage bridge: the host validates the iframe's
 * origin (and `MessageEvent.source`) before surfacing any event, and can post a
 * `checkout:close` back into the frame.
 *
 * Use this (rather than `mount`) when the checkout must run in an isolated
 * origin — e.g. so the merchant page never shares a DOM/JS context with the
 * payment UI.
 */

export interface FrameMountOptions {
  /** URL of the hosted checkout page (the side that calls `bootstrapCheckoutFrame`). */
  url: string;
  publishableKey: string;
  listingId?: string;
  sessionId?: string;
  mode?: CheckoutMode;
  testMode?: boolean;
  /**
   * Origins permitted to message the host. Defaults to the origin of `url`.
   * Messages from any other origin are dropped by the bridge.
   */
  allowedOrigins?: string[];
  /** Extra query parameters appended to the iframe `src`. */
  params?: Record<string, string>;
  title?: string;
  className?: string;
  onReady?: (sessionId: string) => void;
  onStep?: (step: PactoBridgeMessage<'checkout:step'>['payload']['step']) => void;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export interface FrameHandle {
  readonly iframe: HTMLIFrameElement;
  /** Ask the embedded checkout to close, then run the `onClose` callback. */
  close(): void;
  /** Tear down the bridge and remove the iframe from the DOM. */
  destroy(): void;
}

function originOf(url: string): string {
  return new URL(url, typeof window !== 'undefined' ? window.location.href : undefined).origin;
}

function buildFrameSrc(options: FrameMountOptions): string {
  const url = new URL(
    options.url,
    typeof window !== 'undefined' ? window.location.href : undefined,
  );
  const { searchParams } = url;

  searchParams.set('publishableKey', options.publishableKey);
  if (options.listingId) {
    searchParams.set('listingId', options.listingId);
  }
  if (options.sessionId) {
    searchParams.set('sessionId', options.sessionId);
  }
  if (options.mode) {
    searchParams.set('mode', options.mode);
  }
  if (options.testMode) {
    searchParams.set('testMode', 'true');
  }
  if (typeof window !== 'undefined') {
    // The embedded page only accepts/posts messages to this parent origin.
    searchParams.set('parentOrigin', window.location.origin);
  }
  for (const [key, value] of Object.entries(options.params ?? {})) {
    searchParams.set(key, value);
  }

  return url.toString();
}

export function mountFrame(
  selector: string | HTMLElement,
  options: FrameMountOptions,
): FrameHandle {
  if (!options.publishableKey) {
    throw new Error('[pacto-connect] publishableKey is required');
  }

  const target = resolveTarget(selector);
  const frameOrigin = originOf(options.url);
  const allowedOrigins =
    options.allowedOrigins && options.allowedOrigins.length > 0
      ? options.allowedOrigins
      : [frameOrigin];

  const iframe = document.createElement('iframe');
  iframe.src = buildFrameSrc(options);
  iframe.title = options.title ?? 'Pacto checkout';
  iframe.allow = 'payment';
  // Cross-origin isolation: scripts/forms run, but the frame cannot navigate
  // the top window or escape its sandbox.
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups');
  if (options.className) {
    iframe.className = options.className;
  }

  target.append(iframe);

  let bridge: BridgeClient | null = null;
  let host: BridgeHost | null = null;
  let destroyed = false;

  function handleMessage(message: PactoBridgeMessage, event: MessageEvent): void {
    // Only trust messages coming from this iframe's own window.
    if (event.source !== iframe.contentWindow) {
      return;
    }

    switch (message.type) {
      case 'checkout:ready':
        options.onReady?.(message.payload.sessionId);
        break;
      case 'checkout:step':
        options.onStep?.(message.payload.step);
        break;
      case 'checkout:complete':
        options.onComplete?.(message.payload.escrow);
        break;
      case 'checkout:dispute':
        options.onDispute?.(message.payload.escrow);
        break;
      case 'checkout:error':
        options.onError?.(new Error(message.payload.message));
        break;
      case 'checkout:close':
        options.onClose?.();
        break;
    }
  }

  host = createBridgeHost({ allowedOrigins, onMessage: handleMessage });

  return {
    iframe,
    close(): void {
      if (destroyed || !iframe.contentWindow) {
        return;
      }

      // Ask the embedded checkout to close. It echoes `checkout:close` back,
      // which triggers `onClose` via `handleMessage` — so `onClose` fires
      // exactly once whether the close was initiated here or inside the frame.
      bridge ??= createBridgeClient({
        targetWindow: iframe.contentWindow,
        targetOrigin: frameOrigin,
        allowedOrigins,
      });
      bridge.post({ type: 'checkout:close', payload: {} });
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      host?.close();
      host = null;
      bridge?.close();
      bridge = null;
      iframe.remove();
    },
  };
}
