import { describe, expect, it } from 'vitest';
import { BookDeltaSchema, BookSnapshotSchema, CandleSchema, TradeSchema } from '@repo/protocol';
import {
  encodeBookDelta,
  encodeBookSnapshot,
  encodeCandle,
  encodeTrade,
} from '../../src/app/wire.js';
import { MarketEngine } from '../../src/market/market-engine.js';
import { DEFAULT_SYMBOLS } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';

describe('the JSON boundary', () => {
  const engine = new MarketEngine({
    registry: new SymbolRegistry({ symbols: DEFAULT_SYMBOLS, marketSeed: 1337n, bookDepth: 25 }),
    tickMs: 50,
    startTime: 1_700_000_000_000,
  });

  it('encodes a live market to schema-valid, JSON-serialisable wire shapes', () => {
    let trades = 0;
    let deltas = 0;
    let candles = 0;

    for (let tick = 0; tick < 400; tick += 1) {
      engine.advance((result) => {
        for (const trade of result.trades) {
          const encoded = encodeTrade(trade);
          expect(TradeSchema.parse(encoded)).toEqual(encoded);
          // A stray bigint here is a runtime TypeError in production.
          expect(() => JSON.stringify(encoded)).not.toThrow();
          trades += 1;
        }
        if (result.delta !== null) {
          const encoded = encodeBookDelta(result.delta);
          expect(BookDeltaSchema.parse(encoded)).toEqual(encoded);
          expect(() => JSON.stringify(encoded)).not.toThrow();
          deltas += 1;
        }
        for (const candle of result.finalisedCandles) {
          const encoded = encodeCandle(candle, true);
          expect(CandleSchema.parse(encoded)).toEqual(encoded);
          candles += 1;
        }
      });
    }

    expect(trades).toBeGreaterThan(0);
    expect(deltas).toBeGreaterThan(0);
    expect(candles).toBeGreaterThan(0);

    for (const symbolEngine of engine.registry.engines()) {
      const snapshot = encodeBookSnapshot(symbolEngine.snapshot());
      expect(BookSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    }
  });

  it('keeps "0" as the delete sentinel rather than padding it to full scale', () => {
    const encoded = encodeBookDelta({
      symbol: 'BTC-USD',
      previousSequence: 1n,
      sequence: 2n,
      timestamp: 1_700_000_000_000,
      bids: [[672_310_000n, 30_210_000n]],
      asks: [[672_320_000n, 0n]],
    });
    expect(encoded.asks[0]).toEqual(['67232.0000', '0']);
    expect(encoded.bids[0]).toEqual(['67231.0000', '0.30210000']);
    expect(BookDeltaSchema.parse(encoded)).toEqual(encoded);
  });

  it('adds final at the transport, not in the engine', () => {
    const candle = {
      symbol: 'BTC-USD' as const,
      interval: '1s' as const,
      startTime: 1_700_000_000_000,
      open: 672_314_287n,
      high: 672_320_000n,
      low: 672_310_000n,
      close: 672_315_000n,
      volume: 3_124_500n,
      tradeCount: 7,
      lastTradeId: 183_192n,
    };
    expect(encodeCandle(candle, true).final).toBe(true);
    expect(encodeCandle(candle, false).final).toBe(false);
    expect(encodeCandle(candle, true)).not.toHaveProperty('interval');
  });
});
