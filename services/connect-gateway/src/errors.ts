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

export function toGatewayErrorBody(type: string, code: string, message: string): GatewayErrorBody {
  return {
    error: {
      type,
      code,
      message,
    },
  };
}
