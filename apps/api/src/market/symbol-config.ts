import type { MarketSymbol } from '@repo/protocol';

/**
 * The symbol registry table from docs/02-market-domain.md §2.
 *
 * Price scale 4 and quantity scale 8 are uniform — one codec, five
 * personalities. Everything below is fixed-point `bigint`.
 */
export interface SymbolConfig {
  readonly symbol: MarketSymbol;
  /** Opening fair value, price scale 4. */
  readonly basePrice: bigint;
  /** Smallest price increment on the wire. */
  readonly tickSize: bigint;
  /**
   * Gap between two displayed book levels — a whole multiple of `tickSize`.
   * The ladder is a grid: 25 grouped levels covering a band a reviewer can
   * actually read, rather than 25 adjacent ticks covering a fraction of a basis
   * point.
   */
  readonly levelSpacing: bigint;
  /** Best-bid to best-ask gap, in grid steps. */
  readonly spreadSpacings: number;
  /** Largest fair-value step per logical tick, price scale 4. */
  readonly volatility: bigint;
  readonly minTradeQuantity: bigint;
  readonly maxTradeQuantity: bigint;
  readonly minLevelQuantity: bigint;
  readonly maxLevelQuantity: bigint;
  /** Chance of a noise trade in any one logical tick. */
  readonly tradeProbability: number;
  /** Add/cancel liquidity events per logical tick. */
  readonly churnEvents: number;
}

/** Chance that the next noise trade continues the preceding noise-trade direction. */
export const ORDER_FLOW_PERSISTENCE = 0.75;

const config = (c: SymbolConfig): SymbolConfig => Object.freeze(c);

/**
 * Calibration notes, so these are numbers rather than magic:
 *
 * - `levelSpacing` is chosen so 25 levels per side span 15–50 bp of price — deep
 *   enough that the ladder persists for seconds, tight enough to look like a
 *   market.
 * - `volatility` is ≤¼ of `levelSpacing`, so the fair value advances gradually
 *   instead of bouncing through displayed levels every few ticks.
 * - Thinness is the ratio of level size to trade size: BTC and ETH absorb a
 *   typical trade inside one level, HYPE does not — which is what "thinnest
 *   book" means here.
 */
export const SYMBOL_CONFIGS: readonly SymbolConfig[] = Object.freeze([
  config({
    symbol: 'BTC-USD',
    basePrice: 672_314_287n, // 67231.4287
    tickSize: 1_000n, // 0.1000
    levelSpacing: 40_000n, // 4.0000
    spreadSpacings: 1,
    volatility: 3_000n, // 0.3000
    minTradeQuantity: 100_000n, // 0.00100000
    maxTradeQuantity: 100_000_000n, // 1.00000000
    minLevelQuantity: 5_000_000n, // 0.05000000
    maxLevelQuantity: 150_000_000n, // 1.50000000
    tradeProbability: 0.55,
    churnEvents: 3,
  }),
  config({
    symbol: 'ETH-USD',
    basePrice: 35_128_400n, // 3512.8400
    tickSize: 100n, // 0.0100
    levelSpacing: 2_100n, // 0.2100
    spreadSpacings: 1,
    volatility: 150n, // 0.0150
    minTradeQuantity: 1_000_000n, // 0.01000000
    maxTradeQuantity: 2_000_000_000n, // 20.00000000
    minLevelQuantity: 50_000_000n, // 0.50000000
    maxLevelQuantity: 2_500_000_000n, // 25.00000000
    tradeProbability: 0.5,
    churnEvents: 3,
  }),
  config({
    symbol: 'SOL-USD',
    basePrice: 2_143_900n, // 214.3900
    tickSize: 10n, // 0.0010
    levelSpacing: 210n, // 0.0210
    spreadSpacings: 1,
    volatility: 40n, // 0.0040
    minTradeQuantity: 10_000_000n, // 0.10000000
    maxTradeQuantity: 50_000_000_000n, // 500.00000000
    minLevelQuantity: 500_000_000n, // 5.00000000
    maxLevelQuantity: 35_000_000_000n, // 350.00000000
    tradeProbability: 0.45,
    churnEvents: 2,
  }),
  config({
    symbol: 'HYPE-USD',
    basePrice: 387_200n, // 38.7200
    tickSize: 10n, // 0.0010
    levelSpacing: 80n, // 0.0080
    spreadSpacings: 1,
    volatility: 20n, // 0.0020
    minTradeQuantity: 100_000_000n, // 1.00000000
    maxTradeQuantity: 200_000_000_000n, // 2000.00000000
    minLevelQuantity: 2_500_000_000n, // 25.00000000
    maxLevelQuantity: 90_000_000_000n, // 900.00000000
    tradeProbability: 0.4,
    churnEvents: 2,
  }),
  config({
    symbol: 'ZEC-USD',
    basePrice: 3_475_100n, // 347.5100
    tickSize: 100n, // 0.0100
    levelSpacing: 400n, // 0.0400
    spreadSpacings: 1,
    volatility: 60n, // 0.0060
    minTradeQuantity: 10_000_000n, // 0.10000000
    maxTradeQuantity: 30_000_000_000n, // 300.00000000
    minLevelQuantity: 300_000_000n, // 3.00000000
    maxLevelQuantity: 20_000_000_000n, // 200.00000000
    tradeProbability: 0.35,
    churnEvents: 2,
  }),
]);

export const SYMBOL_CONFIG_BY_SYMBOL: ReadonlyMap<MarketSymbol, SymbolConfig> = new Map(
  SYMBOL_CONFIGS.map((entry) => [entry.symbol, entry]),
);

/** The default `MARKET_SYMBOLS` list, in registry order. */
export const DEFAULT_SYMBOLS: readonly MarketSymbol[] = Object.freeze(
  SYMBOL_CONFIGS.map((entry) => entry.symbol),
);
