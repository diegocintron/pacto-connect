import { describe, expect, it } from 'vitest';
import { isTestMode, keyMode } from './keys.js';

describe('isTestMode', () => {
  it('returns true for pk_test_ keys', () => {
    expect(isTestMode('pk_test_123')).toBe(true);
  });

  it('returns false for pk_live_ keys', () => {
    expect(isTestMode('pk_live_123')).toBe(false);
  });

  it('returns false for unknown key prefixes', () => {
    expect(isTestMode('pk_unknown_123')).toBe(false);
  });
});

describe('keyMode', () => {
  it('returns test for pk_test_ keys', () => {
    expect(keyMode('pk_test_abc')).toBe('test');
  });

  it('returns live for pk_live_ keys', () => {
    expect(keyMode('pk_live_abc')).toBe('live');
  });

  it('returns unknown for other prefixes', () => {
    expect(keyMode('pk_other_abc')).toBe('unknown');
  });
});
