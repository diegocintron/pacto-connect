import {
  type BridgeClient,
  CheckoutFlowController,
  type CheckoutMode,
  createBridgeClient,
  type DeepPartial,
  type Escrow,
  type PactoBridgeMessage,
  type PactoLocale,
  type PactoMessages,
  type PactoSessionData,
  type PactoTheme,
  resolveMessages,
} from '@pacto-connect/core';
import { injectCheckoutStyles } from './styles.js';
import { CheckoutView } from './ui.js';

export const ELEMENT_TAG = 'pacto-checkout';

export interface PactoCheckoutOptions {
  publishableKey: string;
  gatewayUrl?: string;
  listingId?: string;
  sessionId?: string;
  clientSecret?: string;
  sessionExpiresAt?: string | Date;
  mode?: CheckoutMode;
  testMode?: boolean;
  allowedOrigins?: string[];
  /** Inject the default modal stylesheet (default `true`). Set `false` to fully self-style. */
  injectStyles?: boolean;
  /** Widget copy locale (default `en`). */
  locale?: PactoLocale;
  /** Per-string copy overrides / additional locale. */
  messages?: DeepPartial<PactoMessages>;
  /** Design tokens applied as `--pacto-*` CSS variables. */
  theme?: DeepPartial<PactoTheme>;
  /** Brand logo shown in the checkout header. */
  logoUrl?: string;
  logoAlt?: string;
  onComplete?: (escrow: Escrow) => void;
  onDispute?: (escrow: Escrow) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

function parseBooleanAttribute(value: string | null): boolean {
  return value !== null && value !== 'false' && value !== '0';
}

function parseAllowedOrigins(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : undefined;
}

function resolveSession(options: PactoCheckoutOptions): PactoSessionData | undefined {
  if (!options.sessionId || !options.clientSecret) {
    return undefined;
  }

  const expiresAt =
    options.sessionExpiresAt instanceof Date
      ? options.sessionExpiresAt
      : options.sessionExpiresAt
        ? new Date(options.sessionExpiresAt)
        : new Date(Date.now() + 60 * 60 * 1000);

  return {
    sessionId: options.sessionId,
    clientSecret: options.clientSecret,
    expiresAt,
    mode: options.mode ?? 'buy',
  };
}

function defaultAllowedOrigins(explicit?: string[]): string[] {
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return [window.location.origin];
  }

  return [];
}

export class PactoCheckoutElement extends HTMLElement {
  private controller: CheckoutFlowController | null = null;
  private view: CheckoutView | null = null;
  private bridge: BridgeClient | null = null;
  private options: PactoCheckoutOptions | null = null;
  private openState = false;
  private readyPosted = false;

  static get observedAttributes(): string[] {
    return [
      'open',
      'publishable-key',
      'gateway-url',
      'listing-id',
      'session-id',
      'client-secret',
      'session-expires-at',
      'mode',
      'test-mode',
      'allowed-origins',
      'inject-styles',
      'locale',
      'logo-url',
      'logo-alt',
    ];
  }

  connectedCallback(): void {
    if (this.hasAttribute('open')) {
      this.open();
    }
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {
      return;
    }

    if (name === 'open') {
      if (newValue !== null) {
        this.open();
      } else {
        this.close();
      }
    }
  }

  open(): void {
    if (this.openState) {
      return;
    }

    this.openState = true;
    this.setAttribute('open', '');
    this.bootstrap();
  }

  close(): void {
    if (!this.openState) {
      return;
    }

    this.openState = false;
    this.removeAttribute('open');
    this.options?.onClose?.();
    this.bridge?.post({ type: 'checkout:close', payload: {} });
    this.teardown();
  }

  applyOptions(options: PactoCheckoutOptions): void {
    this.options = options;
    if (this.openState) {
      this.teardown();
      this.bootstrap();
    }
  }

  readOptionsFromAttributes(): PactoCheckoutOptions {
    return {
      publishableKey: this.getAttribute('publishable-key') ?? '',
      gatewayUrl: this.getAttribute('gateway-url') ?? undefined,
      listingId: this.getAttribute('listing-id') ?? undefined,
      sessionId: this.getAttribute('session-id') ?? undefined,
      clientSecret: this.getAttribute('client-secret') ?? undefined,
      sessionExpiresAt: this.getAttribute('session-expires-at') ?? undefined,
      mode: (this.getAttribute('mode') as CheckoutMode | null) ?? undefined,
      testMode: parseBooleanAttribute(this.getAttribute('test-mode')),
      allowedOrigins: parseAllowedOrigins(this.getAttribute('allowed-origins')),
      injectStyles:
        !this.hasAttribute('inject-styles') ||
        parseBooleanAttribute(this.getAttribute('inject-styles')),
      locale: (this.getAttribute('locale') as PactoLocale | null) ?? undefined,
      logoUrl: this.getAttribute('logo-url') ?? undefined,
      logoAlt: this.getAttribute('logo-alt') ?? undefined,
    };
  }

  private bootstrap(): void {
    const options = this.options ?? this.readOptionsFromAttributes();
    if (!options.publishableKey) {
      throw new Error('[pacto-connect] publishable-key is required');
    }

    this.readyPosted = false;
    this.options = options;

    if (options.injectStyles !== false) {
      injectCheckoutStyles();
    }

    const allowedOrigins = defaultAllowedOrigins(options.allowedOrigins);
    const targetOrigin = allowedOrigins[0] ?? window.location.origin;

    this.bridge = createBridgeClient({
      targetOrigin,
      allowedOrigins,
    });

    const session = resolveSession(options);
    this.controller = new CheckoutFlowController({
      publishableKey: options.publishableKey,
      gatewayUrl: options.gatewayUrl,
      listingId: options.listingId,
      mode: options.mode,
      testMode: options.testMode,
      session,
      onChange: (state) => {
        if (state.sessionId && !this.readyPosted) {
          this.readyPosted = true;
          this.bridge?.post({ type: 'checkout:ready', payload: { sessionId: state.sessionId } });
        }
        this.view?.render();
        this.postBridgeStep();
      },
      onComplete: (escrow) => {
        options.onComplete?.(escrow);
        this.bridge?.post({ type: 'checkout:complete', payload: { escrow } });
      },
      onDispute: (escrow) => {
        options.onDispute?.(escrow);
        this.bridge?.post({ type: 'checkout:dispute', payload: { escrow } });
      },
      onError: (error) => {
        options.onError?.(error);
        this.bridge?.post({ type: 'checkout:error', payload: { message: error.message } });
      },
    });

    this.view = new CheckoutView(this, this.controller, {
      onClose: () => this.close(),
      messages: resolveMessages(options.locale, options.messages),
      theme: options.theme,
      logoUrl: options.logoUrl,
      logoAlt: options.logoAlt,
    });

    void this.controller.start();
  }

  private postBridgeStep(): void {
    const step = this.controller?.getState().step;
    if (step) {
      this.bridge?.post({ type: 'checkout:step', payload: { step } });
    }
  }

  private teardown(): void {
    this.controller?.destroy();
    this.controller = null;
    this.view?.destroy();
    this.view = null;
    this.bridge?.close();
    this.bridge = null;
    this.replaceChildren();
  }
}

export function registerPactoCheckoutElement(): void {
  if (typeof customElements === 'undefined') {
    return;
  }

  if (!customElements.get(ELEMENT_TAG)) {
    customElements.define(ELEMENT_TAG, PactoCheckoutElement);
  }
}

export function applyCheckoutOptions(
  element: PactoCheckoutElement,
  options: PactoCheckoutOptions,
): void {
  if (options.publishableKey) {
    element.setAttribute('publishable-key', options.publishableKey);
  }
  if (options.gatewayUrl) {
    element.setAttribute('gateway-url', options.gatewayUrl);
  }
  if (options.listingId) {
    element.setAttribute('listing-id', options.listingId);
  }
  if (options.sessionId) {
    element.setAttribute('session-id', options.sessionId);
  }
  if (options.clientSecret) {
    element.setAttribute('client-secret', options.clientSecret);
  }
  if (options.sessionExpiresAt) {
    element.setAttribute(
      'session-expires-at',
      options.sessionExpiresAt instanceof Date
        ? options.sessionExpiresAt.toISOString()
        : options.sessionExpiresAt,
    );
  }
  if (options.mode) {
    element.setAttribute('mode', options.mode);
  }
  if (options.testMode) {
    element.setAttribute('test-mode', '');
  }
  if (options.allowedOrigins?.length) {
    element.setAttribute('allowed-origins', options.allowedOrigins.join(','));
  }
  if (options.injectStyles === false) {
    element.setAttribute('inject-styles', 'false');
  }
  if (options.locale) {
    element.setAttribute('locale', options.locale);
  }
  if (options.logoUrl) {
    element.setAttribute('logo-url', options.logoUrl);
  }
  if (options.logoAlt) {
    element.setAttribute('logo-alt', options.logoAlt);
  }

  element.applyOptions(options);
}

export type { PactoBridgeMessage };
