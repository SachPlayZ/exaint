import { describe, expect, it } from 'vitest';
import { MarketSummarySchema } from '@repo/protocol';
import { loadMarketConfig } from '../../src/config/env.js';
import { DEFAULT_SYMBOLS, SYMBOL_CONFIGS } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';

const build = (symbols = DEFAULT_SYMBOLS): SymbolRegistry =>
  new SymbolRegistry({ symbols, marketSeed: 1337n, bookDepth: 25 });

describe('SymbolRegistry', () => {
  it('keeps registry order and gives every symbol its own engine', () => {
    const registry = build();
    expect(registry.symbols).toEqual(DEFAULT_SYMBOLS);
    const books = registry.engines().map((engine) => engine.book);
    expect(new Set(books).size).toBe(DEFAULT_SYMBOLS.length);
    expect(registry.get('BTC-USD')?.symbol).toBe('BTC-USD');
    expect(registry.get('DOGE-USD')).toBeUndefined();
    expect(registry.has('DOGE-USD')).toBe(false);
  });

  it('serves a GET /v1/markets payload that validates against the protocol schema', () => {
    for (const summary of build().summaries()) {
      expect(MarketSummarySchema.parse(summary)).toEqual(summary);
    }
  });

  it('keeps the scales uniform and only the tick size varying', () => {
    const summaries = build().summaries();
    expect(new Set(summaries.map((s) => s.priceScale))).toEqual(new Set([4]));
    expect(new Set(summaries.map((s) => s.quantityScale))).toEqual(new Set([8]));
    expect(new Set(summaries.map((s) => s.tickSize)).size).toBeGreaterThan(1);
    expect(new Set(summaries.map((s) => s.bookDepth))).toEqual(new Set([25]));
  });

  it('can run a subset of the registry', () => {
    const registry = build(['ETH-USD', 'ZEC-USD']);
    expect(registry.symbols).toEqual(['ETH-USD', 'ZEC-USD']);
    expect(registry.has('BTC-USD')).toBe(false);
  });

  it('refuses an unknown or duplicated symbol', () => {
    expect(() => build(['DOGE-USD'])).toThrow(/no registry entry/);
    expect(() => build(['BTC-USD', 'BTC-USD'])).toThrow(/duplicate symbol/);
    expect(() => build([])).toThrow(/at least one symbol/);
  });
});

describe('symbol configuration', () => {
  it('keeps every level spacing a whole multiple of the tick size', () => {
    for (const config of SYMBOL_CONFIGS) {
      expect(config.levelSpacing % config.tickSize, config.symbol).toBe(0n);
      expect(config.minTradeQuantity, config.symbol).toBeLessThan(config.maxTradeQuantity);
      expect(config.minLevelQuantity, config.symbol).toBeLessThan(config.maxLevelQuantity);
      expect(config.volatility, config.symbol).toBeGreaterThan(0n);
    }
  });
});

describe('loadMarketConfig', () => {
  it('defaults to the five-symbol registry, seed 1337, depth 25, 50 ms tick', () => {
    const config = loadMarketConfig({});
    expect(config.symbols).toEqual(DEFAULT_SYMBOLS);
    expect(config.seed).toBe(1337n);
    expect(config.bookDepth).toBe(25);
    expect(config.tickMs).toBe(50);
  });

  it('reads MARKET_SYMBOLS, trimming whitespace and keeping order', () => {
    expect(loadMarketConfig({ MARKET_SYMBOLS: ' ZEC-USD , BTC-USD ' }).symbols).toEqual([
      'ZEC-USD',
      'BTC-USD',
    ]);
  });

  it('rejects configuration it cannot honour', () => {
    expect(() => loadMarketConfig({ MARKET_SYMBOLS: 'DOGE-USD' })).toThrow(/no registry entry/);
    expect(() => loadMarketConfig({ MARKET_SEED: 'banana' })).toThrow(/MARKET_SEED/);
    expect(() => loadMarketConfig({ MARKET_TICK_MS: '0' })).toThrow(/MARKET_TICK_MS/);
    expect(() => loadMarketConfig({ MARKET_BOOK_DEPTH: '-1' })).toThrow(/MARKET_BOOK_DEPTH/);
  });
});
