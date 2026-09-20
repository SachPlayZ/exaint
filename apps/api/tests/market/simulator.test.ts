import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MarketSymbol } from '@repo/protocol';
import { MarketEngine } from '../../src/market/market-engine.js';
import { DEFAULT_SYMBOLS, SYMBOL_CONFIG_BY_SYMBOL } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';

const START_TIME = 1_700_000_000_000;

function buildEngine(
  seed: bigint,
  symbols: readonly MarketSymbol[] = DEFAULT_SYMBOLS,
): MarketEngine {
  return new MarketEngine({
    registry: new SymbolRegistry({ symbols, marketSeed: seed, bookDepth: 25 }),
    tickMs: 50,
    startTime: START_TIME,
  });
}

describe('trade and book coherence (docs/02-market-domain.md §6)', () => {
  it('fills buys from asks and sells from bids, never at a price no level offered', () => {
    const engine = buildEngine(1n);
    for (let tick = 0; tick < 400; tick += 1) {
      const before = new Map(
        engine.registry.engines().map((symbolEngine) => [
          symbolEngine.symbol,
          {
            bid: new Map(symbolEngine.book.levels('bid')),
            ask: new Map(symbolEngine.book.levels('ask')),
          },
        ]),
      );

      engine.advance((result) => {
        const snapshot = before.get(result.symbol);
        expect(snapshot).toBeDefined();
        if (snapshot === undefined) return;

        const consumed = new Map<string, bigint>();
        for (const trade of result.trades) {
          const side = trade.side === 'buy' ? 'ask' : 'bid';
          const key = `${side}@${trade.price}`;
          consumed.set(key, (consumed.get(key) ?? 0n) + trade.quantity);
        }

        for (const [key, quantity] of consumed) {
          const [side, price] = key.split('@') as ['ask' | 'bid', string];
          const available = snapshot[side].get(BigInt(price));
          expect(available, `${result.symbol} ${key} was never resting`).toBeDefined();
          expect(available ?? 0n, `${result.symbol} ${key} overfilled`).toBeGreaterThanOrEqual(
            quantity,
          );
        }
      });
    }
  });

  it('never prints a zero-quantity trade', () => {
    const engine = buildEngine(3n);
    for (let tick = 0; tick < 300; tick += 1) {
      engine.advance((result) => {
        for (const trade of result.trades) {
          expect(trade.quantity).toBeGreaterThan(0n);
          expect(trade.price).toBeGreaterThan(0n);
        }
      });
    }
  });

  it('keeps every price a whole multiple of the symbol tick size', () => {
    const engine = buildEngine(5n);
    for (let tick = 0; tick < 300; tick += 1) {
      engine.advance((result) => {
        const config = SYMBOL_CONFIG_BY_SYMBOL.get(result.symbol);
        expect(config).toBeDefined();
        if (config === undefined) return;
        for (const trade of result.trades) expect(trade.price % config.tickSize).toBe(0n);
        for (const [price] of result.delta?.bids ?? []) expect(price % config.tickSize).toBe(0n);
        for (const [price] of result.delta?.asks ?? []) expect(price % config.tickSize).toBe(0n);
      });
    }
  });

  it('holds the book at exactly the configured depth per side', () => {
    const engine = buildEngine(7n);
    for (let tick = 0; tick < 300; tick += 1) engine.advance();
    for (const symbolEngine of engine.registry.engines()) {
      expect(symbolEngine.book.size('bid'), symbolEngine.symbol).toBe(25);
      expect(symbolEngine.book.size('ask'), symbolEngine.symbol).toBe(25);
    }
  });
});

describe('bid < ask (property)', () => {
  it('never crosses, for any seed and any number of ticks', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 48n }),
        fc.integer({ min: 1, max: 250 }),
        (seed, ticks) => {
          const engine = buildEngine(seed);
          for (let tick = 0; tick < ticks; tick += 1) {
            engine.advance();
            for (const symbolEngine of engine.registry.engines()) {
              const bestBid = symbolEngine.book.bestBid();
              const bestAsk = symbolEngine.book.bestAsk();
              if (bestBid === undefined || bestAsk === undefined) return false;
              if (bestBid >= bestAsk) return false;
              // Every bid must sit below every ask, not just the touch.
              const worstAsk = symbolEngine.book.prices('ask').at(-1) ?? bestAsk;
              if (bestBid >= worstAsk) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('five markets, five personalities (docs/02-market-domain.md §2)', () => {
  const measure = (): Map<MarketSymbol, { mid: bigint; spreadBps: number; rangeBps: number }> => {
    const engine = buildEngine(1337n);
    const lows = new Map<MarketSymbol, bigint>();
    const highs = new Map<MarketSymbol, bigint>();

    for (let tick = 0; tick < 1_200; tick += 1) {
      engine.advance((result) => {
        const symbolEngine = engine.registry.get(result.symbol);
        const bestBid = symbolEngine?.book.bestBid();
        const bestAsk = symbolEngine?.book.bestAsk();
        if (bestBid === undefined || bestAsk === undefined) return;
        const mid = (bestBid + bestAsk) / 2n;
        lows.set(
          result.symbol,
          mid < (lows.get(result.symbol) ?? mid) ? mid : (lows.get(result.symbol) ?? mid),
        );
        highs.set(
          result.symbol,
          mid > (highs.get(result.symbol) ?? mid) ? mid : (highs.get(result.symbol) ?? mid),
        );
      });
    }

    const bps = (part: bigint, whole: bigint): number => Number((part * 1_000_000n) / whole) / 100;
    return new Map(
      engine.registry.engines().map((symbolEngine) => {
        const bestBid = symbolEngine.book.bestBid() ?? 0n;
        const bestAsk = symbolEngine.book.bestAsk() ?? 0n;
        const mid = (bestBid + bestAsk) / 2n;
        const low = lows.get(symbolEngine.symbol) ?? mid;
        const high = highs.get(symbolEngine.symbol) ?? mid;
        return [
          symbolEngine.symbol,
          {
            mid,
            spreadBps: bps(bestAsk - bestBid, mid),
            rangeBps: bps(high - low, (high + low) / 2n),
          },
        ];
      }),
    );
  };

  const stats = measure();
  const of = (symbol: MarketSymbol) => {
    const entry = stats.get(symbol);
    if (entry === undefined) throw new Error(`no stats for ${symbol}`);
    return entry;
  };

  it('puts each symbol at its own price level', () => {
    const mids = DEFAULT_SYMBOLS.map((symbol) => of(symbol).mid);
    expect(new Set(mids.map(String)).size).toBe(DEFAULT_SYMBOLS.length);
    // Within 10% of the configured base price after a simulated minute.
    for (const symbol of DEFAULT_SYMBOLS) {
      const base = SYMBOL_CONFIG_BY_SYMBOL.get(symbol)?.basePrice ?? 0n;
      const drift = Number(((of(symbol).mid - base) * 1_000n) / base) / 10;
      expect(Math.abs(drift), symbol).toBeLessThan(10);
    }
  });

  it('widens the spread from the deep books to the thin one', () => {
    expect(of('BTC-USD').spreadBps).toBeLessThan(of('SOL-USD').spreadBps);
    expect(of('ETH-USD').spreadBps).toBeLessThan(of('SOL-USD').spreadBps);
    expect(of('SOL-USD').spreadBps).toBeLessThan(of('HYPE-USD').spreadBps);
    expect(of('ZEC-USD').spreadBps).toBeLessThan(of('HYPE-USD').spreadBps);
  });

  it('makes HYPE the most volatile and BTC/ETH the calmest', () => {
    expect(of('HYPE-USD').rangeBps).toBeGreaterThan(of('SOL-USD').rangeBps);
    expect(of('SOL-USD').rangeBps).toBeGreaterThan(of('BTC-USD').rangeBps);
    expect(of('ZEC-USD').rangeBps).toBeGreaterThan(of('ETH-USD').rangeBps);
  });
});
