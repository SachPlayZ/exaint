import { describe, expect, it } from 'vitest';
import type { MarketSymbol } from '@repo/protocol';
import type { SymbolTickResult } from '../../src/market/events.js';
import { MarketEngine } from '../../src/market/market-engine.js';
import { DEFAULT_SYMBOLS } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';

const START_TIME = 1_700_000_000_000;

function buildEngine(
  options: {
    seed?: bigint;
    symbols?: readonly MarketSymbol[];
    startTime?: number;
  } = {},
): MarketEngine {
  return new MarketEngine({
    registry: new SymbolRegistry({
      symbols: options.symbols ?? DEFAULT_SYMBOLS,
      marketSeed: options.seed ?? 1n,
      bookDepth: 25,
    }),
    tickMs: 50,
    startTime: options.startTime ?? START_TIME,
  });
}

/** Everything the engine emitted, flattened to comparable text. */
function record(engine: MarketEngine, ticks: number): Map<MarketSymbol, string[]> {
  const stream = new Map<MarketSymbol, string[]>();
  const push = (result: SymbolTickResult): void => {
    const lines = stream.get(result.symbol) ?? [];
    for (const trade of result.trades) {
      lines.push(
        `T ${trade.tradeId} ${trade.timestamp} ${trade.side} ${trade.price} ${trade.quantity}`,
      );
    }
    if (result.delta !== null) {
      const levels = (entries: readonly (readonly [bigint, bigint])[]): string =>
        entries.map(([price, quantity]) => `${price}:${quantity}`).join(',');
      lines.push(
        `D ${result.delta.previousSequence}->${result.delta.sequence} ${result.delta.timestamp} ` +
          `b[${levels(result.delta.bids)}] a[${levels(result.delta.asks)}]`,
      );
    }
    stream.set(result.symbol, lines);
  };
  for (let index = 0; index < ticks; index += 1) engine.advance(push);
  return stream;
}

describe('determinism', () => {
  it('replays byte-identically from the same seed and start time, for all five symbols', () => {
    const first = record(buildEngine(), 600);
    const second = record(buildEngine(), 600);

    expect([...first.keys()]).toEqual([...DEFAULT_SYMBOLS]);
    for (const symbol of DEFAULT_SYMBOLS) {
      const left = first.get(symbol);
      const right = second.get(symbol);
      expect(left, symbol).toBeDefined();
      expect(left?.length ?? 0, symbol).toBeGreaterThan(500);
      expect(right, symbol).toEqual(left);
    }
  });

  it('produces a different universe from a different MARKET_SEED', () => {
    const a = record(buildEngine({ seed: 1n }), 200);
    const b = record(buildEngine({ seed: 2n }), 200);
    for (const symbol of DEFAULT_SYMBOLS) {
      expect(b.get(symbol), symbol).not.toEqual(a.get(symbol));
    }
  });

  it('shifts timestamps but not the random sequence when only the start time moves', () => {
    const strip = (lines: string[]): string[] =>
      lines.map((line) => line.replace(/ 1[0-9]{12}/g, ' <t>'));
    const base = record(buildEngine({ startTime: START_TIME }), 200);
    const later = record(buildEngine({ startTime: START_TIME + 7_777_000 }), 200);
    for (const symbol of DEFAULT_SYMBOLS) {
      expect(strip(later.get(symbol) ?? []), symbol).toEqual(strip(base.get(symbol) ?? []));
      expect(later.get(symbol), symbol).not.toEqual(base.get(symbol));
    }
  });

  it('keeps each symbol stream independent of which other symbols are running', () => {
    const all = record(buildEngine(), 300);
    const alone = record(buildEngine({ symbols: ['ETH-USD'] }), 300);
    expect(alone.get('ETH-USD')).toEqual(all.get('ETH-USD'));
  });

  it('runs the ticks a wall-clock stall owes, in order, with no drift', () => {
    const steady = buildEngine();
    const stalled = buildEngine();

    const steadyStream: SymbolTickResult[] = [];
    for (let wall = START_TIME; wall <= START_TIME + 5_000; wall += 50) {
      steady.runOwedTicks(wall, (result) => steadyStream.push(result));
    }
    const stalledStream: SymbolTickResult[] = [];
    stalled.runOwedTicks(START_TIME + 5_000, (result) => stalledStream.push(result));

    expect(stalled.clock.tick).toBe(steady.clock.tick);
    expect(JSON.stringify(stalledStream, bigintReplacer)).toBe(
      JSON.stringify(steadyStream, bigintReplacer),
    );
  });
});

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

describe('per-symbol counters', () => {
  it('gives every symbol its own bookSequence and tradeId, with nothing shared', () => {
    const engine = buildEngine();
    record(engine, 400);

    const sequences = new Set<string>();
    for (const symbolEngine of engine.registry.engines()) {
      expect(symbolEngine.book.sequence, symbolEngine.symbol).toBeGreaterThan(0n);
      expect(symbolEngine.nextTradeId, symbolEngine.symbol).toBeGreaterThan(1n);
      sequences.add(`${symbolEngine.symbol}:${symbolEngine.nextTradeId}`);
    }
    // Five independent trade counters: identical totals across five different
    // markets would mean one shared counter.
    const tradeCounts = engine.registry.engines().map((e) => e.nextTradeId);
    expect(new Set(tradeCounts).size).toBeGreaterThan(1);
    expect(sequences.size).toBe(DEFAULT_SYMBOLS.length);
  });

  it('starts each symbol at tradeId 1 and bookSequence 0', () => {
    const engine = buildEngine();
    for (const symbolEngine of engine.registry.engines()) {
      expect(symbolEngine.nextTradeId).toBe(1n);
      expect(symbolEngine.book.sequence).toBe(0n);
      expect(symbolEngine.hasTicked).toBe(false);
    }
    expect(engine.ready).toBe(false);
    engine.advance();
    expect(engine.ready).toBe(true);
  });

  it('numbers trades contiguously within a symbol', () => {
    const engine = buildEngine({ symbols: ['SOL-USD'] });
    const ids: bigint[] = [];
    for (let index = 0; index < 200; index += 1) {
      engine.advance((result) => ids.push(...result.trades.map((trade) => trade.tradeId)));
    }
    expect(ids.length).toBeGreaterThan(100);
    expect(ids).toEqual(ids.map((_, index) => BigInt(index + 1)));
  });
});
