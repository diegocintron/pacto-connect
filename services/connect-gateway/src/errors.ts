import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type SessionErrorCode = 'session_invalid' | 'session_expired';

export interface GatewayErrorBody {
  error: {
    type: string;
    code: string;
    message: string;
  };
}

export class SessionError extends Error {
  constructor(
    public readonly code: SessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export function sessionErrorStatus(code: SessionErrorCode): ContentfulStatusCode {
  return code === 'session_expired' ? 410 : 401;
}

export type QuoteErrorCode = 'quote_invalid' | 'quote_expired';

export class QuoteError extends Error {
  constructor(
    public readonly code: QuoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

export function quoteErrorStatus(code: QuoteErrorCode): ContentfulStatusCode {
  return code === 'quote_expired' ? 410 : 400;
}

export type SubscriptionErrorCode = 'subscription_invalid' | 'subscription_not_found';

export class SubscriptionError extends Error {
  constructor(
    public readonly code: SubscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

export function subscriptionErrorStatus(code: SubscriptionErrorCode): ContentfulStatusCode {
  return code === 'subscription_not_found' ? 404 : 400;
}

export function toGatewayErrorBody(type: string, code: string, message: string): GatewayErrorBody {
  return {
    error: {
      type,
      code,
      message,
    },
  };
}
