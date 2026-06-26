export type FxCurrency = 'CRC' | 'MXN' | 'USD';

export const FX_CURRENCIES: readonly FxCurrency[] = ['CRC', 'MXN', 'USD'];

export function isFxCurrency(value: string): value is FxCurrency {
  return (FX_CURRENCIES as readonly string[]).includes(value);
}

export interface FxRate {
  from: FxCurrency;
  to: FxCurrency;
  rate: number;
  source: string;
  asOf: string;
}

export interface FxOracle {
  getRate(from: FxCurrency, to: FxCurrency): FxRate;
}

export class FxOracleError extends Error {
  constructor(
    public readonly code: 'unsupported_currency',
    message: string,
  ) {
    super(message);
    this.name = 'FxOracleError';
  }
}

export interface StaticFxOracleConfig {
  usdPer: Record<FxCurrency, number>;
  asOf: string;
  source?: string;
}

const DEFAULT_STATIC_FX_ORACLE_CONFIG: StaticFxOracleConfig = {
  usdPer: { USD: 1, CRC: 510, MXN: 17 },
  asOf: '2025-06-01T00:00:00.000Z',
  source: 'static',
};

export function createStaticFxOracle(config?: Partial<StaticFxOracleConfig>): FxOracle {
  const merged: StaticFxOracleConfig = {
    ...DEFAULT_STATIC_FX_ORACLE_CONFIG,
    ...config,
    usdPer: {
      ...DEFAULT_STATIC_FX_ORACLE_CONFIG.usdPer,
      ...config?.usdPer,
    },
  };

  const source = merged.source ?? 'static';

  return {
    getRate(from: FxCurrency, to: FxCurrency): FxRate {
      if (!isFxCurrency(from) || !isFxCurrency(to)) {
        throw new FxOracleError(
          'unsupported_currency',
          `Unsupported currency pair: ${from} -> ${to}`,
        );
      }

      const fromPer = merged.usdPer[from];
      const toPer = merged.usdPer[to];

      if (fromPer === undefined || toPer === undefined) {
        throw new FxOracleError(
          'unsupported_currency',
          `Unsupported currency pair: ${from} -> ${to}`,
        );
      }

      const rate = from === to ? 1 : toPer / fromPer;

      return {
        from,
        to,
        rate,
        source,
        asOf: merged.asOf,
      };
    },
  };
}

export const staticFxOracle: FxOracle = createStaticFxOracle();
