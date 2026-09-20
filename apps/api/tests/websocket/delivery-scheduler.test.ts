import { describe, expect, it } from 'vitest';
import { TIER_CADENCE_MS, type Tier } from '@repo/protocol';
import type { DomainCandle } from '../../src/market/candles/candle.js';
import type { DomainTrade, SymbolTickResult } from '../../src/market/events.js';
import { SymbolSubscription } from '../../src/websocket/connection-session.js';
import {
  BACKPRESSURE_HARD_BYTES,
  BACKPRESSURE_SOFT_BYTES,
  enqueue,
  flushDue,
} from '../../src/websocket/delivery-scheduler.js';

const START = 1_700_000_000_000;

function candle(startTime: number, overrides: Partial<DomainCandle> = {}): DomainCandle {
  return {
    symbol: 'BTC-USD',
    interval: '1s',
    startTime,
    open: 1n,
    high: 2n,
    low: 1n,
    close: 2n,
    volume: 10n,
    tradeCount: 1,
    lastTradeId: 1n,
    ...overrides,
  };
}

function trade(tradeId: bigint): DomainTrade {
  return {
    symbol: 'BTC-USD',
    tradeId,
    timestamp: START,
    side: 'buy',
    price: 1n,
    quantity: 1n,
  };
}

function tick(overrides: Partial<SymbolTickResult> = {}): SymbolTickResult {
  return {
    symbol: 'BTC-USD',
    timestamp: START,
    trades: [],
    delta: null,
    finalisedCandles: [],
    activeCandles: [],
    ...overrides,
  };
}

const subscription = (): SymbolSubscription =>
  new SymbolSubscription('BTC-USD', ['book', 'trades', 'candles'], '1s');

describe('delivery scheduler', () => {
  it('coalesces the active candle and accumulates the finalised ones', () => {
    const sub = subscription();
    enqueue(sub, tick({ activeCandles: [candle(START, { close: 5n })] }));
    enqueue(sub, tick({ activeCandles: [candle(START, { close: 9n })] }));
    enqueue(sub, tick({ finalisedCandles: [candle(START - 1_000), candle(START - 2_000)] }));

    expect(sub.pendingFinalCandles).toHaveLength(2);
    expect(sub.latestActiveCandle?.close).toBe(9n);

    const frames = flushDue(sub, START + 10_000, 'minimal');
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    if (frame?.type !== 'candles.update') throw new Error('expected candles.update');
    // Both closed candles plus exactly one active one, newest version.
    expect(frame.candles.filter((c) => c.final)).toHaveLength(2);
    expect(frame.candles.filter((c) => !c.final)).toHaveLength(1);
    expect(sub.pendingFinalCandles).toHaveLength(0);
  });

  it('does not re-send an unchanged active candle on an idle market', () => {
    const sub = subscription();
    enqueue(sub, tick({ activeCandles: [candle(START)] }));
    expect(flushDue(sub, START + 1_000, 'full')).toHaveLength(1);
    expect(flushDue(sub, START + 2_000, 'full')).toHaveLength(0);
  });

  it('honours the per-tier cadence exactly', () => {
    for (const tier of ['full', 'degraded', 'minimal'] as Tier[]) {
      const sub = subscription();
      const cadence = TIER_CADENCE_MS[tier];

      enqueue(sub, tick({ activeCandles: [candle(START)] }));
      expect(flushDue(sub, START, tier), tier).toHaveLength(1);

      enqueue(sub, tick({ activeCandles: [candle(START)] }));
      expect(flushDue(sub, START + cadence.candlesUpdateMs - 1, tier), tier).toHaveLength(0);
      expect(flushDue(sub, START + cadence.candlesUpdateMs, tier), tier).toHaveLength(1);
    }
  });

  it('paces trade batches separately from candles', () => {
    const sub = subscription();
    const cadence = TIER_CADENCE_MS.full;
    expect(cadence.tradesBatchMs).toBe(200);
    expect(cadence.candlesUpdateMs).toBe(100);

    enqueue(sub, tick({ trades: [trade(1n)], activeCandles: [candle(START)] }));
    expect(flushDue(sub, START, 'full')).toHaveLength(2);

    enqueue(sub, tick({ trades: [trade(2n)], activeCandles: [candle(START)] }));
    const atOneHundred = flushDue(sub, START + 100, 'full');
    // The candle cadence is due, the trade cadence is not.
    expect(atOneHundred.map((frame) => frame.type)).toEqual(['candles.update']);
    expect(sub.pendingTrades).toHaveLength(1);

    enqueue(sub, tick({ trades: [trade(3n)] }));
    const atTwoHundred = flushDue(sub, START + 200, 'full');
    expect(atTwoHundred.map((frame) => frame.type)).toEqual(['trades.batch']);
    const batch = atTwoHundred[0];
    if (batch?.type !== 'trades.batch') throw new Error('expected trades.batch');
    // Both queued trades ride the one batch — none is lost, none is doubled.
    expect(batch.trades.map((t) => t.tradeId)).toEqual(['2', '3']);
  });

  it('drops trade batches under soft backpressure but keeps candles', () => {
    const sub = subscription();
    enqueue(sub, tick({ trades: [trade(1n)], activeCandles: [candle(START)] }));

    const frames = flushDue(sub, START + 10_000, 'full', { dropTrades: true });
    expect(frames.map((frame) => frame.type)).toEqual(['candles.update']);
    expect(sub.pendingTrades).toHaveLength(0);
  });

  it('discards candle state when the interval changes', () => {
    const sub = subscription();
    enqueue(sub, tick({ finalisedCandles: [candle(START)], activeCandles: [candle(START)] }));
    expect(sub.pendingFinalCandles).toHaveLength(1);

    sub.setInterval('1m');
    expect(sub.pendingFinalCandles).toHaveLength(0);
    expect(sub.latestActiveCandle).toBeNull();
    // A 1s bucket must never be merged into a 1m stream.
    enqueue(sub, tick({ finalisedCandles: [candle(START, { interval: '1s' })] }));
    expect(sub.pendingFinalCandles).toHaveLength(0);
  });

  it('ignores channels the client did not ask for', () => {
    const sub = new SymbolSubscription('BTC-USD', ['book'], null);
    enqueue(sub, tick({ trades: [trade(1n)], finalisedCandles: [candle(START)] }));
    expect(sub.pendingTrades).toHaveLength(0);
    expect(sub.pendingFinalCandles).toHaveLength(0);
    expect(flushDue(sub, START + 10_000, 'full')).toHaveLength(0);
  });

  it('pins the backpressure thresholds', () => {
    expect(BACKPRESSURE_SOFT_BYTES).toBe(256 * 1024);
    expect(BACKPRESSURE_HARD_BYTES).toBe(1024 * 1024);
    expect(BACKPRESSURE_SOFT_BYTES).toBeLessThan(BACKPRESSURE_HARD_BYTES);
  });
});
