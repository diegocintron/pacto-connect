/**
 * @pacto-connect/core
 *
 * Framework-agnostic SDK core for Pacto Connect.
 */

import {
  errorFromResponse,
  type GatewayErrorBody,
  PactoError,
  PactoSessionError,
} from './errors.js';
import { PUBLISHABLE_KEY_HEADER } from './http.js';
import { createApiClient, type PactoApiClient } from './resources.js';

export {
  PactoApiError,
  PactoAuthError,
  PactoError,
  PactoEscrowError,
  PactoRateLimitError,
  PactoSessionError,
} from './errors.js';
export type {
  CreateEscrowParams,
  CreateQuoteParams,
  Escrow,
  EscrowStatus,
  EscrowStatusResponse,
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

export interface PactoClient {
  readonly publishableKey: string;
  readonly gatewayUrl: string;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<PactoSession>;
  api(session: PactoSession): PactoApiClient;
}

interface GatewaySessionResponse {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  mode: CheckoutMode;
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
}

interface InternalPactoClient extends PactoClient {
  refreshSession(clientSecret: string): Promise<PactoSessionData>;
}

function createGatewayClient(options: PactoInitOptions): InternalPactoClient {
  const publishableKey = options.publishableKey;
  const gatewayUrl = options.gatewayUrl ?? DEFAULT_GATEWAY_URL;
  const origin = options.origin;
  const maxRetries = options.maxRetries;
  const baseDelayMs = options.baseDelayMs;

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
    async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<PactoSession> {
      const data = await requestSession('/v1/session', params);
      return new PactoSession(this, data);
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
