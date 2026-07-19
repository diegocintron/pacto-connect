import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('createRateLimiter', () => {
  it('allows up to max requests in the window then denies with retryAfter', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => clock });

    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(true);

    const denied = limiter.check('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(60);
  });

  it('slides the window: requests succeed again after windowMs', () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1, now: () => clock });

    expect(limiter.check('k').allowed).toBe(true);
    expect(limiter.check('k').allowed).toBe(false);

    clock = 10_001;
    expect(limiter.check('k').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => clock });

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });
});
