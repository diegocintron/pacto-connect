import type { Context, Next } from 'hono';
import { toGatewayErrorBody } from '../errors.js';

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX = 60;

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max } = options;
  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const current = now();
      const windowStart = current - windowMs;
      const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (timestamps.length >= max) {
        hits.set(key, timestamps);
        const oldest = timestamps[0] ?? current;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - current) / 1000));
        return { allowed: false, retryAfterSeconds, remaining: 0 };
      }

      timestamps.push(current);
      hits.set(key, timestamps);
      return { allowed: true, retryAfterSeconds: 0, remaining: max - timestamps.length };
    },
  };
}

function parsePositiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRateLimitConfig(): { windowMs: number; max: number } {
  return {
    windowMs: parsePositiveEnv('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS),
    max: parsePositiveEnv('RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX),
  };
}

export function rateLimitMiddleware(
  limiter: RateLimiter,
  keyOf: (c: Context) => string | undefined,
) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const key = keyOf(c);
    if (!key) {
      return next();
    }

    const result = limiter.check(key);
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSeconds));
      return c.json(
        toGatewayErrorBody('rate_limit_error', 'too_many_requests', 'rate limit exceeded'),
        429,
      );
    }

    return next();
  };
}
