import type { Interval, MarketSymbol } from '@repo/protocol';
import { INTERVAL_MS } from '@repo/protocol';
import type { DomainTrade } from '../events.js';
import { CANDLE_HISTORY_CAPACITY, candleStart, type DomainCandle } from './candle.js';
import { CandleRingBuffer } from './ring-buffer.js';

/**
 * One symbol, one interval. Folds canonical trades into OHLCV buckets.
 *
 * This class knows nothing about tiers, connections, or clients. There is
 * exactly one of it per symbol per interval in the process, and every client is
 * served from its output — which is what I2 is
 * (docs/07-invariants.md#i2--candle-invariance).
 */
export class CandleAggregator {
  readonly symbol: MarketSymbol;
  readonly interval: Interval;
  readonly intervalMs: number;

  readonly #history: CandleRingBuffer;
  #active: DomainCandle | null = null;

  constructor(symbol: MarketSymbol, interval: Interval, capacity = CANDLE_HISTORY_CAPACITY) {
    this.symbol = symbol;
    this.interval = interval;
    this.intervalMs = INTERVAL_MS[interval];
    this.#history = new CandleRingBuffer(capacity);
  }

  /** The open bucket, or `null` when no trade has landed in the current one. */
  get active(): DomainCandle | null {
    return this.#active;
  }

  /** Finalised candles, oldest first. */
  history(limit = Number.POSITIVE_INFINITY): DomainCandle[] {
    return Number.isFinite(limit) ? this.#history.recent(limit) : this.#history.toArray();
  }

  /**
   * Closes the active bucket if `timestamp` has moved past its end.
   *
   * This is what lets a bucket finalise on an idle market. A bucket that saw no
   * trades produces no candle at all — an empty interval is a gap in the series,
   * never a fabricated zero-volume bar.
   */
  closeThrough(timestamp: number): DomainCandle | null {
    const active = this.#active;
    if (active === null) return null;
    if (timestamp < active.startTime + this.intervalMs) return null;
    this.#history.push(active);
    this.#active = null;
    return active;
  }

  /**
   * Folds one trade in. Returns the candle that closed because of it, if any.
   *
   * Trades arrive in `tradeId` order within a symbol, which is the ordering that
   * counts (I3) — timestamps are display data.
   */
  apply(trade: DomainTrade): DomainCandle | null {
    const start = candleStart(trade.timestamp, this.intervalMs);
    const finalised = this.closeThrough(start);
    const active = this.#active;

    if (active === null || active.startTime !== start) {
      this.#active = {
        symbol: this.symbol,
        interval: this.interval,
        startTime: start,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity,
        tradeCount: 1,
        lastTradeId: trade.tradeId,
      };
      return finalised;
    }

    this.#active = {
      ...active,
      high: trade.price > active.high ? trade.price : active.high,
      low: trade.price < active.low ? trade.price : active.low,
      close: trade.price,
      // Exact, in bigint. A float `+=` over 10,000 trades drifts, and test T3
      // catches it an hour after you stop looking.
      volume: active.volume + trade.quantity,
      tradeCount: active.tradeCount + 1,
      lastTradeId: trade.tradeId > active.lastTradeId ? trade.tradeId : active.lastTradeId,
    };
    return finalised;
  }
}
