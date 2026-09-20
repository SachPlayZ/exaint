import type { ServerFrame } from '@repo/protocol';
import { CLOSE_CODES } from '@repo/protocol';
import { encodeBookDelta } from '../app/wire.js';
import type { SymbolTickResult } from '../market/events.js';
import { METRIC, type MetricsRegistry } from '../observability/metrics.js';
import type { ConnectionSession } from './connection-session.js';
import {
  BACKPRESSURE_HARD_BYTES,
  BACKPRESSURE_SOFT_BYTES,
  enqueue,
  flushDue,
} from './delivery-scheduler.js';

/** One open socket, from the dispatcher's point of view. */
export interface ConnectionHandle {
  readonly session: ConnectionSession;
  readonly isOpen: () => boolean;
  readonly send: (frame: ServerFrame) => void;
  readonly bufferedAmount: () => number;
  readonly close: (code: number, reason: string) => void;
  readonly onResyncClose?: (reason: string) => void;
}

/**
 * Fans canonical market events out to interested connections, through each
 * connection's own scheduler.
 *
 * One subscription to the runtime for the whole process, not one per socket:
 * the market is computed once and every client is served from it
 * (docs/07-invariants.md#i2--candle-invariance).
 */
export class MarketDispatcher {
  readonly #connections = new Set<ConnectionHandle>();
  readonly #metrics: MetricsRegistry;
  readonly #now: () => number;

  constructor(metrics: MetricsRegistry, now: () => number = Date.now) {
    this.#metrics = metrics;
    this.#now = now;
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
    const now = this.#now();

    for (const handle of this.#connections) {
      if (!handle.isOpen()) continue;
      const subscription = handle.session.subscription(result.symbol);
      if (subscription === undefined) continue;

      const buffered = handle.bufferedAmount();
      if (buffered > BACKPRESSURE_HARD_BYTES) {
        // Book deltas may never be dropped, so there is no lever left. A closed
        // socket is an observable resync; a dropped delta is silent corruption.
        handle.send({ type: 'error', code: 'BACKPRESSURE_CLOSE' });
        handle.onResyncClose?.('backpressure');
        handle.close(CLOSE_CODES.BACKPRESSURE, 'outbound book stream unrecoverable');
        continue;
      }

      // Never paced, never coalesced, never dropped — deltas carry correctness.
      if (subscription.channels.has('book') && result.delta !== null) {
        handle.send(encodeBookDelta(result.delta));
      }

      enqueue(subscription, result);
      const tier = handle.session.effectiveTier;
      const frames = flushDue(subscription, now, tier, {
        dropTrades: buffered > BACKPRESSURE_SOFT_BYTES,
      });

      for (const frame of frames) {
        handle.send(frame);
        const metric =
          frame.type === 'candles.update'
            ? METRIC.candleUpdatesDelivered
            : METRIC.tradeBatchesDelivered;
        this.#metrics.increment(metric, { symbol: result.symbol, tier });
      }
    }
  }
}
