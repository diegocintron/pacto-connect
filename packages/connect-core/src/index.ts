/**
 * @pacto-connect/core
 *
 * Framework-agnostic SDK core for Pacto Connect.
 */

export {
  type BridgeClient,
  type BridgeClientOptions,
  type BridgeHost,
  type BridgeHostOptions,
  createBridgeClient,
  createBridgeHost,
  isOriginAllowed,
  isPactoBridgeEnvelope,
  PACTO_BRIDGE_SOURCE,
  PACTO_BRIDGE_VERSION,
  type PactoBridgeEnvelope,
  type PactoBridgeEventType,
  type PactoBridgeMessage,
  type PactoBridgePayloadMap,
} from './bridge.js';
export {
  CheckoutFlowController,
  type CheckoutFlowOptions,
  type CheckoutFlowState,
  type CheckoutStep,
} from './checkout-flow.js';
export {
  type CheckoutMode,
  type CreateCheckoutSessionParams,
  DEFAULT_GATEWAY_URL,
  init,
  Pacto,
  type PactoClient,
  type PactoInitOptions,
  PactoSession,
  type PactoSessionData,
} from './client.js';
export {
  PactoApiError,
  PactoAuthError,
  PactoError,
  PactoEscrowError,
  PactoRateLimitError,
  PactoSessionError,
} from './errors.js';
export {
  ESCROW_EVENT_NAMES,
  type EscrowEvent,
  type EscrowEventHandler,
  type EscrowEventName,
  type EscrowMilestone,
  type EscrowSubscribeOptions,
} from './escrow-events.js';
export { isTestMode, keyMode } from './keys.js';
export type {
  CreateEscrowParams,
  CreateQuoteParams,
  DepositParams,
  Escrow,
  EscrowStatus,
  EscrowStatusResponse,
  FiatPaymentMethod,
  FiatReceiptParams,
  Listing,
  PactoApiClient,
  Quote,
} from './resources.js';

export const VERSION = '0.0.0';

export type CheckoutMode = 'buy' | 'sell';

export interface PactoInitOptions {
  /** Publishable key issued by the Connect Gateway (pk_live_* / pk_test_*). */
  publishableKey: string;
  /** Gateway base URL. Defaults to the hosted Pacto Connect gateway. */
  gatewayUrl?: string;
  /** Origin header for non-browser environments. */
  origin?: string;
  /** Maximum retry attempts for transient failures. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs?: number;
  /** Maximum reconnect attempts for escrow event streams. */
  maxReconnectAttempts?: number;
}

export type CreateCheckoutSessionParams =
  | { listingId: string; mode: CheckoutMode }
  | { quote: Record<string, unknown>; mode: CheckoutMode };

export interface PactoSessionData {
  sessionId: string;
  clientSecret: string;
  expiresAt: Date;
  mode: CheckoutMode;
}

export type FxCurrency = 'CRC' | 'MXN' | 'USD';

export interface GetQuoteParams {
  from: FxCurrency;
  to: FxCurrency;
  amount: number;
}

export interface FxQuoteData {
  quoteId: string;
  from: FxCurrency;
  to: FxCurrency;
  amount: number;
  baseRate: number;
  spreadBps: number;
  effectiveRate: number;
  toAmount: number;
  source: string;
  asOf: string;
  expiresAt: Date;
  token: string;
}

export interface PactoClient {
  readonly publishableKey: string;
  readonly gatewayUrl: string;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<PactoSession>;
  getQuote(params: GetQuoteParams): Promise<PactoFxQuote>;
  api(session: PactoSession): PactoApiClient;
}

interface GatewaySessionResponse {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  mode: CheckoutMode;
}

interface GatewayQuotePayload {
  quoteId: string;
  from: FxCurrency;
  to: FxCurrency;
  amount: number;
  baseRate: number;
  spreadBps: number;
  effectiveRate: number;
  toAmount: number;
  source: string;
  asOf: string;
  expiresAt: string;
  token: string;
}

interface GatewayQuoteResponse {
  quote: GatewayQuotePayload;
}

interface SessionRuntimeConfig {
  gatewayUrl: string;
  publishableKey: string;
  origin?: string;
  baseDelayMs?: number;
  maxRetries?: number;
  maxReconnectAttempts?: number;
}

const DEFAULT_GATEWAY_URL = 'https://connect.pacto.example';

function isCheckoutMode(value: string): value is CheckoutMode {
  return value === 'buy' || value === 'sell';
}

export class PactoSession {
  readonly sessionId: string;
  readonly clientSecret: string;
  readonly expiresAt: Date;
  readonly mode: CheckoutMode;

  private subscriber?: EscrowEventSubscriber;

  constructor(
    private readonly client: InternalPactoClient,
    data: PactoSessionData,
  ) {
    this.sessionId = data.sessionId;
    this.clientSecret = data.clientSecret;
    this.expiresAt = data.expiresAt;
    this.mode = data.mode;
  }

  isExpired(): boolean {
    return this.expiresAt.getTime() <= Date.now();
  }

  async refresh(): Promise<PactoSession> {
    const data = await this.client.refreshSession(this.clientSecret);
    return new PactoSession(this.client, data);
  }

  on(event: EscrowEventName, handler: EscrowEventHandler, options?: EscrowSubscribeOptions): void {
    if (!this.subscriber) {
      this.subscriber = new EscrowEventSubscriber({
        gatewayUrl: this.client.runtime.gatewayUrl,
        publishableKey: this.client.runtime.publishableKey,
        clientSecret: this.clientSecret,
        origin: this.client.runtime.origin,
        baseDelayMs: this.client.runtime.baseDelayMs,
        maxReconnectAttempts: this.client.runtime.maxReconnectAttempts,
      });
    }

    this.subscriber.on(event, handler, options);
  }

  off(event: EscrowEventName, handler: EscrowEventHandler): void {
    this.subscriber?.off(event, handler);
  }

  closeEvents(): void {
    this.subscriber?.close();
    this.subscriber = undefined;
  }
}

export class PactoFxQuote {
  readonly quoteId: string;
  readonly from: FxCurrency;
  readonly to: FxCurrency;
  readonly amount: number;
  readonly baseRate: number;
  readonly spreadBps: number;
  readonly effectiveRate: number;
  readonly toAmount: number;
  readonly source: string;
  readonly asOf: string;
  readonly expiresAt: Date;
  /** Opaque signed token consumed by checkout to lock the quoted price; verified server-side. */
  readonly token: string;

  constructor(data: FxQuoteData) {
    this.quoteId = data.quoteId;
    this.from = data.from;
    this.to = data.to;
    this.amount = data.amount;
    this.baseRate = data.baseRate;
    this.spreadBps = data.spreadBps;
    this.effectiveRate = data.effectiveRate;
    this.toAmount = data.toAmount;
    this.source = data.source;
    this.asOf = data.asOf;
    this.expiresAt = data.expiresAt;
    this.token = data.token;
  }

  isExpired(): boolean {
    return this.expiresAt.getTime() <= Date.now();
  }
}

interface InternalPactoClient extends PactoClient {
  readonly runtime: SessionRuntimeConfig;
  refreshSession(clientSecret: string): Promise<PactoSessionData>;
}

function createGatewayClient(options: PactoInitOptions): InternalPactoClient {
  const publishableKey = options.publishableKey;
  const gatewayUrl = options.gatewayUrl ?? DEFAULT_GATEWAY_URL;
  const origin = options.origin;
  const maxRetries = options.maxRetries;
  const baseDelayMs = options.baseDelayMs;
  const maxReconnectAttempts = options.maxReconnectAttempts;

  const runtime: SessionRuntimeConfig = {
    gatewayUrl,
    publishableKey,
    origin,
    baseDelayMs,
    maxRetries,
    maxReconnectAttempts,
  };

  async function requestSession(
    path: string,
    body: Record<string, unknown>,
  ): Promise<PactoSessionData> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [PUBLISHABLE_KEY_HEADER]: publishableKey,
    };

    if (origin) {
      headers.Origin = origin;
    }

    const response = await fetch(`${gatewayUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const responseBody = (await response.json()) as GatewaySessionResponse & GatewayErrorBody;

    if (!response.ok) {
      throw errorFromResponse(response.status, responseBody, { path });
    }

    if (
      !responseBody.sessionId ||
      !responseBody.clientSecret ||
      !responseBody.expiresAt ||
      !isCheckoutMode(responseBody.mode)
    ) {
      throw new PactoError(
        'gateway_error',
        'invalid_response',
        'Gateway returned an invalid session payload',
      );
    }

    return {
      sessionId: responseBody.sessionId,
      clientSecret: responseBody.clientSecret,
      expiresAt: new Date(responseBody.expiresAt),
      mode: responseBody.mode,
    };
  }

  return {
    publishableKey,
    gatewayUrl,
    runtime,
    async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<PactoSession> {
      const data = await requestSession('/v1/session', params);
      return new PactoSession(this, data);
    },
    async getQuote(params: GetQuoteParams): Promise<PactoFxQuote> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [PUBLISHABLE_KEY_HEADER]: publishableKey,
      };

      if (origin) {
        headers.Origin = origin;
      }

      const response = await fetch(`${gatewayUrl}/v1/quote`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: params.from,
          to: params.to,
          amount: params.amount,
        }),
      });

      const responseBody = (await response.json()) as GatewayQuoteResponse & GatewayErrorBody;

      if (!response.ok) {
        throw errorFromResponse(response.status, responseBody, {
          path: '/v1/quote',
          resource: 'quote',
        });
      }

      const q = responseBody.quote;
      if (!q || typeof q.token !== 'string' || typeof q.expiresAt !== 'string') {
        throw new PactoError(
          'gateway_error',
          'invalid_response',
          'Gateway returned an invalid quote payload',
        );
      }

      return new PactoFxQuote({
        quoteId: q.quoteId,
        from: q.from,
        to: q.to,
        amount: q.amount,
        baseRate: q.baseRate,
        spreadBps: q.spreadBps,
        effectiveRate: q.effectiveRate,
        toAmount: q.toAmount,
        source: q.source,
        asOf: q.asOf,
        expiresAt: new Date(q.expiresAt),
        token: q.token,
      });
    },
    async refreshSession(clientSecret: string): Promise<PactoSessionData> {
      return requestSession('/v1/session/refresh', { clientSecret });
    },
    api(session: PactoSession): PactoApiClient {
      return createApiClient({
        gatewayUrl,
        publishableKey,
        clientSecret: session.clientSecret,
        origin,
        maxRetries,
        baseDelayMs,
      });
    },
  };
}

/** Entry point for the Pacto Connect SDK. */
export function init(options: PactoInitOptions): PactoClient {
  if (!options.publishableKey) {
    throw new Error('[pacto-connect] publishableKey is required');
  }

  return createGatewayClient(options);
}

export const Pacto = { init, VERSION };
