import type { Interval, MarketSymbol } from '@repo/protocol';
import { CANDLE_HISTORY_LIMIT_MAX } from '@repo/protocol';

/**
 * A canonical OHLCV bucket. Values are `bigint` fixed-point — this is not a wire
 * type (docs/02-market-domain.md §8).
 *
 * There is no `final` field. Finality is a fact about the clock, not state the
 * engine stores; the transport states it on the wire so the client never has to
 * infer it.
 */
export interface DomainCandle {
  readonly symbol: MarketSymbol;
  readonly interval: Interval;
  readonly startTime: number;
  readonly open: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly close: bigint;
  readonly volume: bigint;
  readonly tradeCount: number;
  /**
   * Highest `tradeId` folded into this candle. It is what makes two versions of
   * the same candle comparable during the client's history/realtime merge — the
   * higher one wins. Not decoration.
   */
  readonly lastTradeId: bigint;
}

/**
 * Ring-buffer capacity per symbol per interval: the `limit=300` the REST history
 * endpoint will serve (`CANDLE_HISTORY_LIMIT_MAX`) plus 20% headroom, so a
 * request for the maximum never races the buffer's own eviction.
 */
export const CANDLE_HISTORY_CAPACITY = Math.ceil(CANDLE_HISTORY_LIMIT_MAX * 1.2);

/** The start of the bucket a timestamp belongs to. */
export function candleStart(timestamp: number, intervalMs: number): number {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}
