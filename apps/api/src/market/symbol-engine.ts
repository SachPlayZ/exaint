import type { MarketSymbol } from '@repo/protocol';
import type { DomainBookSnapshot, SymbolTickResult } from './events.js';
import { OrderBook } from './orderbook/order-book.js';
import { MarketSimulator } from './simulator/generator.js';
import { Prng } from './simulator/prng.js';
import type { SymbolConfig } from './symbol-config.js';

/**
 * One symbol, end to end: its own PRNG stream, its own order book with its own
 * `bookSequence`, and its own `tradeId` counter. Nothing is shared with another
 * symbol (docs/adr/0006-per-symbol-engines.md).
 *
 * Candle aggregators join this class in P3.
 */
export class SymbolEngine {
  readonly symbol: MarketSymbol;
  readonly config: SymbolConfig;
  readonly book: OrderBook;

  readonly #simulator: MarketSimulator;
  #nextTradeId = 1n;
  #ticks = 0;

  constructor(config: SymbolConfig, seed: bigint, bookDepth: number) {
    this.symbol = config.symbol;
    this.config = config;
    this.book = new OrderBook(config.symbol, bookDepth);
    this.#simulator = new MarketSimulator(config, new Prng(seed));
    this.#simulator.seedBook(this.book);
  }

  /** True once this engine has produced its first tick — gates `/readyz`. */
  get hasTicked(): boolean {
    return this.#ticks > 0;
  }

  get ticks(): number {
    return this.#ticks;
  }

  /** The next `tradeId` this engine will hand out. Per symbol, never shared. */
  get nextTradeId(): bigint {
    return this.#nextTradeId;
  }

  get fairValue(): bigint {
    return this.#simulator.fairValue;
  }

  snapshot(): DomainBookSnapshot {
    return this.book.snapshot();
  }

  tick(timestamp: number): SymbolTickResult {
    const trades = this.#simulator.tick(this.book, timestamp, () => this.#nextTradeId++);
    const delta = this.book.flushDelta(timestamp);
    this.#ticks += 1;
    return { symbol: this.symbol, timestamp, trades, delta };
  }
}
