import { describe, expect, it } from 'vitest';
import type { Interval, MarketSymbol } from '@repo/protocol';
import { INTERVAL_MS } from '@repo/protocol';
import { CANDLE_INTERVALS } from '../../src/market/candles/symbol-candles.js';
import { candleStart, type DomainCandle } from '../../src/market/candles/candle.js';
import type { DomainTrade } from '../../src/market/events.js';
import { MarketEngine } from '../../src/market/market-engine.js';
import { DEFAULT_SYMBOLS } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';

const START_TIME = 1_700_000_000_000;
const TICKS = 2_400; // two simulated minutes

function buildEngine(): MarketEngine {
  return new MarketEngine({
    registry: new SymbolRegistry({ symbols: DEFAULT_SYMBOLS, marketSeed: 1337n, bookDepth: 25 }),
    tickMs: 50,
    startTime: START_TIME,
  });
}

/** Recomputes OHLCV from the raw trade stream, independently of the aggregator. */
function foldTrades(trades: readonly DomainTrade[], interval: Interval): Map<number, DomainCandle> {
  const intervalMs = INTERVAL_MS[interval];
  const buckets = new Map<number, DomainCandle>();
  for (const trade of trades) {
    const start = candleStart(trade.timestamp, intervalMs);
    const existing = buckets.get(start);
    if (existing === undefined) {
      buckets.set(start, {
        symbol: trade.symbol,
        interval,
        startTime: start,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity,
        tradeCount: 1,
        lastTradeId: trade.tradeId,
      });
      continue;
    }
    buckets.set(start, {
      ...existing,
      high: trade.price > existing.high ? trade.price : existing.high,
      low: trade.price < existing.low ? trade.price : existing.low,
      close: trade.price,
      volume: existing.volume + trade.quantity,
      tradeCount: existing.tradeCount + 1,
      lastTradeId: trade.tradeId > existing.lastTradeId ? trade.tradeId : existing.lastTradeId,
    });
  }
  return buckets;
}

describe('candle engine against a live market', () => {
  const engine = buildEngine();
  const trades = new Map<MarketSymbol, DomainTrade[]>();
  const emitted = new Map<MarketSymbol, DomainCandle[]>();

  for (let tick = 0; tick < TICKS; tick += 1) {
    engine.advance((result) => {
      trades.set(result.symbol, [...(trades.get(result.symbol) ?? []), ...result.trades]);
      emitted.set(result.symbol, [
        ...(emitted.get(result.symbol) ?? []),
        ...result.finalisedCandles,
      ]);
    });
  }

  it('runs fifteen aggregators — three per symbol, none shared', () => {
    const sets = engine.registry.engines().map((symbolEngine) => symbolEngine.candles);
    expect(new Set(sets).size).toBe(DEFAULT_SYMBOLS.length);
    let total = 0;
    for (const set of sets) {
      expect(set.intervals).toEqual([...CANDLE_INTERVALS]);
      total += set.intervals.length;
    }
    expect(total).toBe(15);
  });

  it.each(DEFAULT_SYMBOLS.flatMap((s) => CANDLE_INTERVALS.map((i) => [s, i] as const)))(
    '%s %s candles match an independent fold of the raw trade stream',
    (symbol, interval) => {
      const symbolEngine = engine.registry.get(symbol);
      const aggregator = symbolEngine?.candles.get(interval);
      expect(aggregator).toBeDefined();
      if (aggregator === undefined) return;

      const expected = foldTrades(trades.get(symbol) ?? [], interval);
      const produced = [...aggregator.history()];
      if (aggregator.active !== null) produced.push(aggregator.active);

      expect(produced.length).toBeGreaterThan(0);
      for (const candle of produced) {
        expect(candle, `${symbol} ${interval} @${candle.startTime}`).toEqual(
          expected.get(candle.startTime),
        );
      }
      // Nothing invented and nothing lost, within the window the ring buffer holds.
      const oldest = produced[0]?.startTime ?? 0;
      const inWindow = [...expected.keys()].filter((start) => start >= oldest);
      expect(produced.map((c) => c.startTime)).toEqual(inWindow.sort((a, b) => a - b));
    },
  );

  it('emits every finalised candle exactly once', () => {
    for (const symbol of DEFAULT_SYMBOLS) {
      const finalised = emitted.get(symbol) ?? [];
      expect(finalised.length, symbol).toBeGreaterThan(0);
      const keys = finalised.map((candle) => `${candle.interval}@${candle.startTime}`);
      expect(new Set(keys).size, symbol).toBe(keys.length);

      // Per interval, finalised candles arrive in chronological order.
      for (const interval of CANDLE_INTERVALS) {
        const starts = finalised
          .filter((candle) => candle.interval === interval)
          .map((candle) => candle.startTime);
        expect(starts, `${symbol} ${interval}`).toEqual([...starts].sort((a, b) => a - b));
      }
    }
  });

  it('never finalises the bucket a later trade still belongs to', () => {
    for (const symbol of DEFAULT_SYMBOLS) {
      const symbolTrades = trades.get(symbol) ?? [];
      const lastTimestamp = symbolTrades[symbolTrades.length - 1]?.timestamp ?? 0;
      for (const candle of emitted.get(symbol) ?? []) {
        const end = candle.startTime + INTERVAL_MS[candle.interval];
        expect(end, `${symbol} ${candle.interval}`).toBeLessThanOrEqual(lastTimestamp + 50);
      }
    }
  });

  it('carries candles that agree with the trades that built them', () => {
    for (const symbol of DEFAULT_SYMBOLS) {
      for (const candle of emitted.get(symbol) ?? []) {
        expect(candle.high).toBeGreaterThanOrEqual(candle.low);
        expect(candle.high).toBeGreaterThanOrEqual(candle.open);
        expect(candle.high).toBeGreaterThanOrEqual(candle.close);
        expect(candle.low).toBeLessThanOrEqual(candle.open);
        expect(candle.low).toBeLessThanOrEqual(candle.close);
        expect(candle.volume).toBeGreaterThan(0n);
        expect(candle.tradeCount).toBeGreaterThan(0);
        expect(candle.symbol).toBe(symbol);
      }
    }
  });
});
