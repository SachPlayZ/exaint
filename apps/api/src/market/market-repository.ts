import type { BookSnapshot, Candle, Interval, MarketSummary } from '@repo/protocol';
import { CANDLE_HISTORY_LIMIT_MAX } from '@repo/protocol';
import { encodeBookSnapshot, encodeCandle } from '../app/wire.js';
import type { SymbolRegistry } from './symbol-registry.js';

/**
 * Read access to canonical state for the REST layer. The only place that turns
 * domain state into wire shapes for a request (docs/00-architecture.md §4).
 */
export class MarketRepository {
  readonly #registry: SymbolRegistry;

  constructor(registry: SymbolRegistry) {
    this.#registry = registry;
  }

  markets(): MarketSummary[] {
    return this.#registry.summaries();
  }

  has(symbol: string): boolean {
    return this.#registry.has(symbol);
  }

  bookSnapshot(symbol: string): BookSnapshot | undefined {
    const engine = this.#registry.get(symbol);
    return engine === undefined ? undefined : encodeBookSnapshot(engine.snapshot());
  }

  /**
   * Completed history **plus** the canonical current candle, the last one marked
   * `final: false`.
   *
   * `limit` bounds the whole response, active candle included — a request for
   * `limit=300` never returns 301 rows. Returning the active candle is a
   * deliberate choice: the chart renders immediately and then transitions to
   * `series.update()` without a seam (docs/01-protocol.md §4).
   */
  candles(symbol: string, interval: Interval, limit: number): Candle[] | undefined {
    const aggregator = this.#registry.get(symbol)?.candles.get(interval);
    if (aggregator === undefined) return undefined;

    const bounded = Math.max(1, Math.min(limit, CANDLE_HISTORY_LIMIT_MAX));
    const active = aggregator.active;
    const historyLimit = active === null ? bounded : bounded - 1;

    const candles = aggregator.history(historyLimit).map((candle) => encodeCandle(candle, true));
    if (active !== null) candles.push(encodeCandle(active, false));
    return candles;
  }

  /** True once **every** engine has produced its first tick. */
  get ready(): boolean {
    return this.#registry.engines().every((engine) => engine.hasTicked);
  }

  pendingSymbols(): string[] {
    return this.#registry
      .engines()
      .filter((engine) => !engine.hasTicked)
      .map((engine) => engine.symbol);
  }
}
