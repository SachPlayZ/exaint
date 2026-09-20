import type { MarketSymbol, Side } from '@repo/protocol';
import type { DomainCandle } from './candles/candle.js';

/**
 * Domain events. Values are `bigint` fixed-point — these are *not* wire types.
 * The transport layer encodes them into `@repo/protocol` shapes at the JSON
 * boundary (docs/00-architecture.md §3, docs/02-market-domain.md §5).
 */

export interface DomainTrade {
  readonly symbol: MarketSymbol;
  /** Strictly increasing within this symbol. Never compared across symbols (I3). */
  readonly tradeId: bigint;
  readonly timestamp: number;
  readonly side: Side;
  readonly price: bigint;
  readonly quantity: bigint;
}

/** `[price, quantity]`. Quantity `0n` in a delta deletes the level. */
export type DomainBookLevel = readonly [price: bigint, quantity: bigint];

export interface DomainBookSnapshot {
  readonly symbol: MarketSymbol;
  readonly sequence: bigint;
  readonly bids: readonly DomainBookLevel[];
  readonly asks: readonly DomainBookLevel[];
}

export interface DomainBookDelta {
  readonly symbol: MarketSymbol;
  readonly previousSequence: bigint;
  readonly sequence: bigint;
  readonly timestamp: number;
  readonly bids: readonly DomainBookLevel[];
  readonly asks: readonly DomainBookLevel[];
}

/** What one symbol produced during one logical tick. */
export interface SymbolTickResult {
  readonly symbol: MarketSymbol;
  readonly timestamp: number;
  readonly trades: readonly DomainTrade[];
  /** `null` when nothing in the book changed — no change, no sequence burned. */
  readonly delta: DomainBookDelta | null;
  /**
   * Buckets that closed on this tick, across every interval. Delivery may pace
   * these but must never drop one — that is what I2 costs.
   */
  readonly finalisedCandles: readonly DomainCandle[];
  /** The open bucket per interval, present only on ticks that saw a trade. */
  readonly activeCandles: readonly DomainCandle[];
}
