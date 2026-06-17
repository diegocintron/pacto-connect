/**
 * @pacto-connect/core
 *
 * Framework-agnostic SDK core for Pacto Connect.
 */

export const VERSION = '0.0.0';

export type CheckoutMode = 'buy' | 'sell';

export interface PactoInitOptions {
  /** Publishable key issued by the Connect Gateway (pk_live_* / pk_test_*). */
  publishableKey: string;
  /** Gateway base URL. Defaults to the hosted Pacto Connect gateway. */
  gatewayUrl?: string;
  /** Origin header for non-browser environments. */
  origin?: string;
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
}

export class PactoError extends Error {
  constructor(
    public readonly type: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PactoError';
  }
}

export class PactoSessionError extends PactoError {
  constructor(code: 'session_invalid' | 'session_expired', message: string) {
    super('session_error', code, message);
    this.name = 'PactoSessionError';
  }
}

interface GatewayErrorResponse {
  error?: {
    type?: string;
    code?: string;
    message?: string;
  };
}

interface GatewaySessionResponse {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  mode: CheckoutMode;
}

const DEFAULT_GATEWAY_URL = 'https://connect.pacto.example';
const PUBLISHABLE_KEY_HEADER = 'x-pacto-publishable-key';

function isCheckoutMode(value: string): value is CheckoutMode {
  return value === 'buy' || value === 'sell';
}

function parseGatewayError(body: GatewayErrorResponse, status: number): PactoError {
  const code = body.error?.code ?? 'unknown_error';
  const type = body.error?.type ?? 'gateway_error';
  const message = body.error?.message ?? `Gateway request failed with status ${status}`;

  if (type === 'session_error' && (code === 'session_invalid' || code === 'session_expired')) {
    return new PactoSessionError(code, message);
  }

  return new PactoError(type, code, message);
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

    const responseBody = (await response.json()) as GatewaySessionResponse & GatewayErrorResponse;

    if (!response.ok) {
      throw parseGatewayError(responseBody, response.status);
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
