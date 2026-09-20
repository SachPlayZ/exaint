import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Interval, MarketSymbol } from '@repo/protocol';
import { CANDLE_HISTORY_LIMIT_MAX, INTERVAL_MS } from '@repo/protocol';
import { CandleAggregator } from '../../src/market/candles/aggregator.js';
import {
  CANDLE_HISTORY_CAPACITY,
  candleStart,
  type DomainCandle,
} from '../../src/market/candles/candle.js';
import { CandleRingBuffer } from '../../src/market/candles/ring-buffer.js';
import { CANDLE_INTERVALS, SymbolCandleSet } from '../../src/market/candles/symbol-candles.js';
import type { DomainTrade } from '../../src/market/events.js';

const SYMBOL: MarketSymbol = 'BTC-USD';
const BASE = 1_700_000_000_000;

let nextId = 0n;
function trade(overrides: {
  timestamp: number;
  price: bigint;
  quantity: bigint;
  tradeId?: bigint;
  symbol?: MarketSymbol;
}): DomainTrade {
  nextId += 1n;
  return {
    symbol: overrides.symbol ?? SYMBOL,
    tradeId: overrides.tradeId ?? nextId,
    timestamp: overrides.timestamp,
    side: 'buy',
    price: overrides.price,
    quantity: overrides.quantity,
  };
}

describe('candleStart', () => {
  it('floors to the bucket the timestamp belongs to', () => {
    expect(candleStart(BASE + 1, 1_000)).toBe(BASE);
    expect(candleStart(BASE + 999, 1_000)).toBe(BASE);
    expect(candleStart(BASE + 1_000, 1_000)).toBe(BASE + 1_000);
    expect(candleStart(BASE + 7_321, 5_000)).toBe(BASE + 5_000);
    // BASE is 1s- and 5s-aligned but not 1m-aligned, which is the point.
    const minute = candleStart(BASE, 60_000);
    expect(minute).toBeLessThan(BASE);
    expect(candleStart(minute + 59_999, 60_000)).toBe(minute);
    expect(candleStart(minute + 60_000, 60_000)).toBe(minute + 60_000);
  });

  it('agrees with the protocol interval table', () => {
    expect(INTERVAL_MS).toEqual({ '1s': 1_000, '5s': 5_000, '1m': 60_000 });
  });
});

describe('CandleAggregator OHLCV', () => {
  it('builds a single-trade candle whose open, high, low and close all match', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    aggregator.apply(trade({ timestamp: BASE + 10, price: 100n, quantity: 5n }));
    const active = aggregator.active;
    expect(active).not.toBeNull();
    expect(active).toMatchObject({
      startTime: BASE,
      open: 100n,
      high: 100n,
      low: 100n,
      close: 100n,
      volume: 5n,
      tradeCount: 1,
    });
  });

  it('tracks open, high, low, close and exact volume across a bucket', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    for (const [offset, price, quantity] of [
      [0, 100n, 1n],
      [100, 130n, 2n],
      [200, 90n, 3n],
      [900, 110n, 4n],
    ] as const) {
      aggregator.apply(trade({ timestamp: BASE + offset, price, quantity }));
    }
    expect(aggregator.active).toMatchObject({
      open: 100n,
      high: 130n,
      low: 90n,
      close: 110n,
      volume: 10n,
      tradeCount: 4,
    });
  });

  it('closes the bucket on the first trade of the next one, and only then', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    expect(
      aggregator.apply(trade({ timestamp: BASE + 999, price: 100n, quantity: 1n })),
    ).toBeNull();
    const finalised = aggregator.apply(
      trade({ timestamp: BASE + 1_000, price: 200n, quantity: 1n }),
    );
    expect(finalised?.startTime).toBe(BASE);
    expect(finalised?.close).toBe(100n);
    expect(aggregator.active?.startTime).toBe(BASE + 1_000);
    expect(aggregator.history()).toHaveLength(1);
  });

  it('puts a trade exactly on a boundary in the new bucket', () => {
    const aggregator = new CandleAggregator(SYMBOL, '5s');
    aggregator.apply(trade({ timestamp: BASE + 4_999, price: 100n, quantity: 1n }));
    aggregator.apply(trade({ timestamp: BASE + 5_000, price: 200n, quantity: 1n }));
    expect(aggregator.history().map((c) => c.startTime)).toEqual([BASE]);
    expect(aggregator.active?.startTime).toBe(BASE + 5_000);
  });

  it('finalises on the clock when the market goes quiet', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    aggregator.apply(trade({ timestamp: BASE + 10, price: 100n, quantity: 1n }));
    expect(aggregator.closeThrough(BASE + 999)).toBeNull();
    expect(aggregator.closeThrough(BASE + 1_000)?.startTime).toBe(BASE);
    expect(aggregator.active).toBeNull();
    // Nothing left to close: a second call must not emit the same candle twice.
    expect(aggregator.closeThrough(BASE + 9_000)).toBeNull();
  });

  it('leaves a gap for an empty interval rather than fabricating a zero-volume bar', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    aggregator.apply(trade({ timestamp: BASE, price: 100n, quantity: 1n }));
    aggregator.apply(trade({ timestamp: BASE + 5_000, price: 200n, quantity: 1n }));
    aggregator.closeThrough(BASE + 6_000);

    const starts = aggregator.history().map((candle) => candle.startTime);
    expect(starts).toEqual([BASE, BASE + 5_000]);
    expect(starts).not.toContain(BASE + 1_000);
    for (const candle of aggregator.history()) expect(candle.tradeCount).toBeGreaterThan(0);
  });

  it('carries the highest tradeId as the merge tiebreaker', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    aggregator.apply(trade({ timestamp: BASE, price: 100n, quantity: 1n, tradeId: 41n }));
    aggregator.apply(trade({ timestamp: BASE + 1, price: 101n, quantity: 1n, tradeId: 42n }));
    expect(aggregator.active?.lastTradeId).toBe(42n);
  });

  it('keeps history ascending and unique by startTime', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    for (let index = 0; index < 50; index += 1) {
      aggregator.apply(trade({ timestamp: BASE + index * 1_000, price: 100n, quantity: 1n }));
    }
    const starts = aggregator.history().map((candle) => candle.startTime);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('holds no float anywhere in the value path', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s');
    aggregator.apply(trade({ timestamp: BASE, price: 672_314_287n, quantity: 3_124_500n }));
    const candle = aggregator.active;
    expect(candle).not.toBeNull();
    if (candle === null) return;
    for (const key of ['open', 'high', 'low', 'close', 'volume', 'lastTradeId'] as const) {
      expect(typeof candle[key], key).toBe('bigint');
    }
    expect(Number.isInteger(candle.startTime)).toBe(true);
    expect(Number.isInteger(candle.tradeCount)).toBe(true);
  });
});

describe('volume accumulates exactly (property)', () => {
  it('sums in bigint with zero precision loss, where a float sum would drift', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 10n ** 12n }), { minLength: 1, maxLength: 400 }),
        (quantities) => {
          const aggregator = new CandleAggregator(SYMBOL, '1m');
          for (const [index, quantity] of quantities.entries()) {
            aggregator.apply(trade({ timestamp: BASE + index, price: 1n, quantity }));
          }
          const expected = quantities.reduce((total, quantity) => total + quantity, 0n);
          return aggregator.active?.volume === expected;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('stays exact over 10,000 trades where a float accumulator does not', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1m');
    const quantity = 3_124_567n;
    let float = 0;
    for (let index = 0; index < 10_000; index += 1) {
      aggregator.apply(trade({ timestamp: BASE + index, price: 1n, quantity }));
      float += Number(quantity) / 1e8;
    }
    const exact = quantity * 10_000n;
    expect(aggregator.active?.volume).toBe(exact);
    // The float path is off — which is the entire reason for the bigint path.
    expect(float).not.toBe(Number(exact) / 1e8);
  });
});

describe('SymbolCandleSet', () => {
  it('fans every trade out to this symbol s three intervals and no others', () => {
    const set = new SymbolCandleSet(SYMBOL);
    expect(set.intervals).toEqual([...CANDLE_INTERVALS]);
    set.apply(trade({ timestamp: BASE, price: 100n, quantity: 7n }));
    const active = set.active();
    expect(active).toHaveLength(3);
    expect(new Set(active.map((candle) => candle.interval))).toEqual(new Set(CANDLE_INTERVALS));
    for (const candle of active) {
      expect(candle.symbol).toBe(SYMBOL);
      expect(candle.volume).toBe(7n);
    }
  });

  it('closes 1s buckets repeatedly while the 1m bucket stays open', () => {
    const set = new SymbolCandleSet(SYMBOL);
    const finalised: DomainCandle[] = [];
    for (let second = 0; second < 10; second += 1) {
      finalised.push(...set.closeThrough(BASE + second * 1_000));
      finalised.push(
        ...set.apply(trade({ timestamp: BASE + second * 1_000, price: 100n, quantity: 1n })),
      );
    }
    const byInterval = new Map<Interval, number>();
    for (const candle of finalised) {
      byInterval.set(candle.interval, (byInterval.get(candle.interval) ?? 0) + 1);
    }
    expect(byInterval.get('1s')).toBe(9);
    expect(byInterval.get('5s')).toBe(1);
    expect(byInterval.get('1m') ?? 0).toBe(0);
    expect(set.get('1m')?.active?.tradeCount).toBe(10);
  });
});

describe('CandleRingBuffer', () => {
  it('is sized for the REST limit plus headroom', () => {
    expect(CANDLE_HISTORY_CAPACITY).toBeGreaterThan(CANDLE_HISTORY_LIMIT_MAX);
  });

  it('evicts oldest first and keeps order', () => {
    const buffer = new CandleRingBuffer(3);
    const make = (startTime: number): DomainCandle => ({
      symbol: SYMBOL,
      interval: '1s',
      startTime,
      open: 1n,
      high: 1n,
      low: 1n,
      close: 1n,
      volume: 1n,
      tradeCount: 1,
      lastTradeId: 1n,
    });
    for (const start of [1, 2, 3, 4, 5]) buffer.push(make(start));
    expect(buffer.size).toBe(3);
    expect(buffer.toArray().map((c) => c.startTime)).toEqual([3, 4, 5]);
    expect(buffer.recent(2).map((c) => c.startTime)).toEqual([4, 5]);
    expect(buffer.recent(0)).toEqual([]);
    expect(buffer.last()?.startTime).toBe(5);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new CandleRingBuffer(0)).toThrow(RangeError);
  });

  it('keeps only the newest CANDLE_HISTORY_CAPACITY candles', () => {
    const aggregator = new CandleAggregator(SYMBOL, '1s', 4);
    for (let index = 0; index < 10; index += 1) {
      aggregator.apply(trade({ timestamp: BASE + index * 1_000, price: 100n, quantity: 1n }));
    }
    expect(aggregator.history()).toHaveLength(4);
    expect(aggregator.history()[0]?.startTime).toBe(BASE + 5_000);
  });
});
