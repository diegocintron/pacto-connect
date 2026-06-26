import { describe, expect, it } from 'vitest';
import {
  createStaticFxOracle,
  type FxCurrency,
  FxOracleError,
  staticFxOracle,
} from './fx-oracle.js';

describe('fx-oracle', () => {
  it('returns USD to CRC at 510 units per USD', () => {
    const rate = staticFxOracle.getRate('USD', 'CRC');

    expect(rate.rate).toBe(510);
    expect(rate.from).toBe('USD');
    expect(rate.to).toBe('CRC');
  });

  it('returns CRC to USD as the inverse of the USD to CRC rate', () => {
    const rate = staticFxOracle.getRate('CRC', 'USD');

    expect(rate.rate).toBeCloseTo(1 / 510);
  });

  it('computes cross rates from the shared USD table', () => {
    const rate = staticFxOracle.getRate('CRC', 'MXN');

    expect(rate.rate).toBeCloseTo(17 / 510);
  });

  it('returns 1 for same-currency pairs', () => {
    for (const currency of ['USD', 'CRC', 'MXN'] as const) {
      const rate = staticFxOracle.getRate(currency, currency);

      expect(rate.rate).toBe(1);
      expect(rate.from).toBe(currency);
      expect(rate.to).toBe(currency);
    }
  });

  it('throws FxOracleError for unsupported currencies', () => {
    expect(() => staticFxOracle.getRate('EUR' as FxCurrency, 'USD')).toThrow(FxOracleError);
    expect(() => staticFxOracle.getRate('EUR' as FxCurrency, 'USD')).toThrow(
      expect.objectContaining({ code: 'unsupported_currency' }),
    );
  });

  it('applies custom usdPer overrides from createStaticFxOracle', () => {
    const oracle = createStaticFxOracle({
      usdPer: { USD: 1, CRC: 600, MXN: 17 },
    });

    expect(oracle.getRate('USD', 'CRC').rate).toBe(600);
    expect(oracle.getRate('CRC', 'USD').rate).toBeCloseTo(1 / 600);
  });

  it('propagates source and asOf from the oracle config onto returned rates', () => {
    const oracle = createStaticFxOracle({
      source: 'test-provider',
      asOf: '2025-07-15T12:00:00.000Z',
    });

    const rate = oracle.getRate('USD', 'MXN');

    expect(rate.source).toBe('test-provider');
    expect(rate.asOf).toBe('2025-07-15T12:00:00.000Z');
  });
});
