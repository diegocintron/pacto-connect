export interface GatewayErrorBody {
  error?: {
    type?: string;
    code?: string;
    message?: string;
  };
}

export interface ErrorContext {
  path: string;
  resource?: 'escrow' | 'quote' | 'listing';
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

export class PactoAuthError extends PactoError {
  constructor(code: string, message: string) {
    super('auth_error', code, message);
    this.name = 'PactoAuthError';
  }
}

export class PactoRateLimitError extends PactoError {
  readonly retryAfter?: number;

  constructor(code: string, message: string, retryAfter?: number) {
    super('rate_limit_error', code, message);
    this.name = 'PactoRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class PactoEscrowError extends PactoError {
  constructor(code: string, message: string) {
    super('escrow_error', code, message);
    this.name = 'PactoEscrowError';
  }
}

export class PactoApiError extends PactoError {
  constructor(code: string, message: string) {
    super('api_error', code, message);
    this.name = 'PactoApiError';
  }
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

export function errorFromResponse(
  status: number,
  body: GatewayErrorBody,
  context: ErrorContext,
  headers?: Headers,
): PactoError {
  const code = body.error?.code ?? 'unknown_error';
  const type = body.error?.type ?? 'gateway_error';
  const message = body.error?.message ?? `Gateway request failed with status ${status}`;

  if (type === 'session_error' && (code === 'session_invalid' || code === 'session_expired')) {
    return new PactoSessionError(code, message);
  }

  if (status === 401 || status === 403) {
    return new PactoAuthError(code, message);
  }

  if (status === 429) {
    const retryAfter = headers ? parseRetryAfter(headers) : undefined;
    return new PactoRateLimitError(code, message, retryAfter);
  }

  if (
    context.resource === 'escrow' ||
    context.path.includes('/escrows') ||
    type === 'escrow_error'
  ) {
    return new PactoEscrowError(code, message);
  }

  if (type === 'api_error' || status >= 400) {
    return new PactoApiError(code, message);
  }

  return new PactoError(type, code, message);
}
