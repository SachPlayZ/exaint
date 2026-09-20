import type { MarketSummary, MarketSymbol } from '@repo/protocol';
import { formatPrice } from '@repo/protocol';
import { PRICE_SCALE, QUANTITY_SCALE } from './fixed-point.js';
import { deriveSymbolSeed } from './simulator/prng.js';
import { SYMBOL_CONFIG_BY_SYMBOL, type SymbolConfig } from './symbol-config.js';
import { SymbolEngine } from './symbol-engine.js';

/**
 * Owns the five `SymbolEngine`s and is the only module aware that more than one
 * symbol exists (docs/00-architecture.md §4).
 */
export class SymbolRegistry {
  readonly #engines = new Map<MarketSymbol, SymbolEngine>();
  readonly #order: MarketSymbol[] = [];

  constructor(options: {
    readonly symbols: readonly MarketSymbol[];
    readonly marketSeed: bigint;
    readonly bookDepth: number;
  }) {
    for (const symbol of options.symbols) {
      const config = SYMBOL_CONFIG_BY_SYMBOL.get(symbol);
      if (config === undefined) {
        throw new Error(`no registry entry for symbol "${symbol}"`);
      }
      if (this.#engines.has(symbol)) {
        throw new Error(`duplicate symbol "${symbol}" in MARKET_SYMBOLS`);
      }
      this.#engines.set(
        symbol,
        new SymbolEngine(config, deriveSymbolSeed(options.marketSeed, symbol), options.bookDepth),
      );
      this.#order.push(symbol);
    }
    if (this.#order.length === 0) {
      throw new Error('MARKET_SYMBOLS must list at least one symbol');
    }
  }

  /** Registry order — the order ticks are applied in, and the order clients see. */
  get symbols(): readonly MarketSymbol[] {
    return this.#order;
  }

  has(symbol: string): boolean {
    return this.#engines.has(symbol);
  }

  get(symbol: string): SymbolEngine | undefined {
    return this.#engines.get(symbol);
  }

  engines(): SymbolEngine[] {
    return this.#order.map((symbol) => {
      const engine = this.#engines.get(symbol);
      if (engine === undefined) throw new Error('unreachable: registry order out of sync');
      return engine;
    });
  }

  configs(): SymbolConfig[] {
    return this.engines().map((engine) => engine.config);
  }

  /** The `GET /v1/markets` payload. Scales are uniform; only `tickSize` varies. */
  summaries(): MarketSummary[] {
    return this.engines().map((engine) => ({
      symbol: engine.symbol,
      priceScale: PRICE_SCALE,
      quantityScale: QUANTITY_SCALE,
      tickSize: formatPrice(engine.config.tickSize),
      bookDepth: engine.book.depth,
    }));
  }
}
