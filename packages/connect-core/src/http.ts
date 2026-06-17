import {
  type ErrorContext,
  errorFromResponse,
  type GatewayErrorBody,
  PactoApiError,
  PactoError,
} from './errors.js';

export const PUBLISHABLE_KEY_HEADER = 'x-pacto-publishable-key';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpClientOptions {
  gatewayUrl: string;
  publishableKey: string;
  clientSecret: string;
  origin?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestParams {
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown> | object;
  idempotent?: boolean;
  resource?: ErrorContext['resource'];
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWriteMethod(method: HttpMethod): boolean {
  return method !== 'GET';
}

function shouldRetry(status: number, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) {
    return false;
  }

  return status === 429 || status >= 500;
}

function getBackoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return exponential + jitter;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get('Retry-After');
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

async function parseJsonSafe(response: Response): Promise<GatewayErrorBody> {
  try {
    return (await response.json()) as GatewayErrorBody;
  } catch {
    return {};
  }
}

export async function request<T>(options: HttpClientOptions, params: RequestParams): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleepFn = options.sleep ?? defaultSleep;
  const idempotencyKey =
    (params.idempotent ?? isWriteMethod(params.method)) ? crypto.randomUUID() : undefined;

  let attempt = 0;

  while (true) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.clientSecret}`,
      [PUBLISHABLE_KEY_HEADER]: options.publishableKey,
    };

    if (options.origin) {
      headers.Origin = options.origin;
    }

    if (idempotencyKey) {
      headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;
    }

    try {
      const response = await fetch(`${options.gatewayUrl}${params.path}`, {
        method: params.method,
        headers,
        body: params.body ? JSON.stringify(params.body) : undefined,
      });

      const body = await parseJsonSafe(response);
      const context: ErrorContext = { path: params.path, resource: params.resource };

      if (response.ok) {
        return body as T;
      }

      const error = errorFromResponse(response.status, body, context, response.headers);

      if (shouldRetry(response.status, attempt, maxRetries)) {
        const retryAfter = response.status === 429 ? parseRetryAfter(response.headers) : undefined;
        const delay = retryAfter ?? getBackoffDelay(attempt, baseDelayMs);
        await sleepFn(delay);
        attempt += 1;
        continue;
      }

      throw error;
    } catch (error) {
      if (error instanceof PactoError) {
        throw error;
      }

      if (attempt >= maxRetries) {
        const message = error instanceof Error ? error.message : 'Network request failed';
        throw new PactoApiError('network_error', message);
      }

      await sleepFn(getBackoffDelay(attempt, baseDelayMs));
      attempt += 1;
    }
  }
}
