import type { ServerFrame, Tier } from '@repo/protocol';
import { TIER_CADENCE_MS } from '@repo/protocol';
import { encodeCandle, encodeTrade } from '../app/wire.js';
import type { SymbolTickResult } from '../market/events.js';
import type { SymbolSubscription } from './connection-session.js';

/**
 * Per-connection, per-symbol send pacing.
 *
 * Tiering decides **how often** a client is updated. It never decides what the
 * update says — the canonical values already exist before this file runs
 * (docs/03-adaptive-delivery.md §1, docs/07-invariants.md#i2--candle-invariance).
 *
 * The asymmetry is the whole trick: the finalised queue **accumulates** so every
 * closed candle is delivered exactly once, while the active slot **coalesces**
 * because only the newest version of an open bucket matters.
 */

/**
 * Outbound buffer at which trade batches start being dropped. A 25-level
 * `book.delta` is roughly 200–600 bytes, so 256 KiB is about twenty seconds of
 * one symbol's deltas — well past "briefly congested".
 */
export const BACKPRESSURE_SOFT_BYTES = 256 * 1024;

/**
 * Outbound buffer at which the socket is closed. Book deltas may never be
 * dropped, so once the buffer is this far behind there is no lever left: a
 * closed socket triggers a clean, observable resync, while a dropped delta
 * silently corrupts the client's book (docs/03-adaptive-delivery.md §9).
 */
export const BACKPRESSURE_HARD_BYTES = 1024 * 1024;

/** Folds one tick's output into the subscription's pending state. */
export function enqueue(subscription: SymbolSubscription, result: SymbolTickResult): void {
  if (subscription.channels.has('trades') && result.trades.length > 0) {
    subscription.pendingTrades.push(...result.trades);
  }

  const interval = subscription.subscribedInterval;
  if (!subscription.channels.has('candles') || interval === null) return;

  for (const candle of result.finalisedCandles) {
    if (candle.interval === interval) subscription.pendingFinalCandles.push(candle);
  }
  for (const candle of result.activeCandles) {
    if (candle.interval === interval) subscription.latestActiveCandle = candle;
  }
}

export interface FlushOptions {
  /** Set under soft backpressure: trade batches are display-only and droppable. */
  readonly dropTrades?: boolean;
}

/**
 * Returns the frames due at `now` for `tier`, and advances the send clocks.
 *
 * A send emits **every** pending finalised candle plus the newest active one, so
 * a Minimal client updated once every two seconds still receives each `1s`
 * candle that closed in between.
 */
export function flushDue(
  subscription: SymbolSubscription,
  now: number,
  tier: Tier,
  options: FlushOptions = {},
): ServerFrame[] {
  const cadence = TIER_CADENCE_MS[tier];
  const frames: ServerFrame[] = [];

  const interval = subscription.subscribedInterval;
  const hasCandles =
    subscription.pendingFinalCandles.length > 0 || subscription.latestActiveCandle !== null;
  if (
    interval !== null &&
    hasCandles &&
    now - subscription.lastCandleSentAt >= cadence.candlesUpdateMs
  ) {
    const candles = [
      ...subscription.pendingFinalCandles.map((candle) => encodeCandle(candle, true)),
      ...(subscription.latestActiveCandle === null
        ? []
        : [encodeCandle(subscription.latestActiveCandle, false)]),
    ];
    subscription.pendingFinalCandles = [];
    // Cleared, not retained: an idle market must not re-send an unchanged bucket
    // ten times a second.
    subscription.latestActiveCandle = null;
    subscription.lastCandleSentAt = now;
    frames.push({ type: 'candles.update', symbol: subscription.symbol, interval, candles });
  }

  if (subscription.pendingTrades.length > 0) {
    if (options.dropTrades === true) {
      subscription.pendingTrades = [];
    } else if (now - subscription.lastTradeBatchSentAt >= cadence.tradesBatchMs) {
      frames.push({
        type: 'trades.batch',
        symbol: subscription.symbol,
        trades: subscription.pendingTrades.map(encodeTrade),
      });
      subscription.pendingTrades = [];
      subscription.lastTradeBatchSentAt = now;
    }
  }

  return frames;
}
