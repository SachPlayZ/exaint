import type { ServerFrame } from '@repo/protocol';
import { encodeBookDelta, encodeCandle, encodeTrade } from '../app/wire.js';
import type { SymbolTickResult } from '../market/events.js';
import { METRIC, type MetricsRegistry } from '../observability/metrics.js';
import type { ConnectionSession } from './connection-session.js';

/** One open socket, from the dispatcher's point of view. */
export interface ConnectionHandle {
  readonly session: ConnectionSession;
  readonly isOpen: () => boolean;
  readonly send: (frame: ServerFrame) => void;
}

/**
 * Fans canonical market events out to interested connections.
 *
 * One subscription to the runtime for the whole process, not one per socket:
 * the market is computed once and every client is served from it
 * (docs/07-invariants.md#i2--candle-invariance).
 *
 * P5 sends as data arrives. P6 puts the per-connection scheduler in front of
 * `candles.update` and `trades.batch` — book deltas stay unpaced either way,
 * because they carry correctness rather than decoration.
 */
export class MarketDispatcher {
  readonly #connections = new Set<ConnectionHandle>();
  readonly #metrics: MetricsRegistry;

  constructor(metrics: MetricsRegistry) {
    this.#metrics = metrics;
  }

  get size(): number {
    return this.#connections.size;
  }

  add(handle: ConnectionHandle): void {
    this.#connections.add(handle);
  }

  remove(handle: ConnectionHandle): void {
    this.#connections.delete(handle);
  }

  dispatch(result: SymbolTickResult): void {
    if (this.#connections.size === 0) return;

    for (const handle of this.#connections) {
      const subscription = handle.session.subscription(result.symbol);
      if (subscription === undefined || !handle.isOpen()) continue;
      const tier = handle.session.effectiveTier;

      if (subscription.channels.has('book') && result.delta !== null) {
        handle.send(encodeBookDelta(result.delta));
      }

      if (subscription.channels.has('trades') && result.trades.length > 0) {
        handle.send({
          type: 'trades.batch',
          symbol: result.symbol,
          trades: result.trades.map(encodeTrade),
        });
        this.#metrics.increment(METRIC.tradeBatchesDelivered, { symbol: result.symbol, tier });
      }

      const interval = subscription.subscribedInterval;
      if (!subscription.channels.has('candles') || interval === null) continue;

      const candles = [
        ...result.finalisedCandles
          .filter((candle) => candle.interval === interval)
          .map((candle) => encodeCandle(candle, true)),
        ...result.activeCandles
          .filter((candle) => candle.interval === interval)
          .map((candle) => encodeCandle(candle, false)),
      ];
      if (candles.length === 0) continue;

      handle.send({ type: 'candles.update', symbol: result.symbol, interval, candles });
      this.#metrics.increment(METRIC.candleUpdatesDelivered, { symbol: result.symbol, tier });
    }
  }
}
