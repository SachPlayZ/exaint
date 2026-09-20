import { describe, expect, it } from 'vitest';
import type { Candle, Interval, MarketSymbol, ServerFrame, Tier } from '@repo/protocol';
import { TIER_CADENCE_MS } from '@repo/protocol';
import { encodeCandle } from '../../src/app/wire.js';
import type { SymbolTickResult } from '../../src/market/events.js';
import { MarketEngine } from '../../src/market/market-engine.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';
import { ConnectionSession, SymbolSubscription } from '../../src/websocket/connection-session.js';
import { enqueue, flushDue } from '../../src/websocket/delivery-scheduler.js';
import { ConnectionRateLimiter } from '../../src/websocket/rate-limiter.js';

/**
 * T3 — candle equality across tiers. The single most valuable test in the repo:
 * it proves the central claim of the whole system.
 *
 * A "virtual client" is an in-process `ConnectionSession` plus its schedulers,
 * with a fake socket and a fake clock. No network, no browser.
 */

const START_TIME = 1_700_000_000_000;
const TICK_MS = 50;

class VirtualClient {
  readonly tier: Tier;
  readonly session: ConnectionSession;
  readonly sent: ServerFrame[] = [];

  constructor(tier: Tier, symbols: readonly MarketSymbol[], interval: Interval) {
    this.tier = tier;
    this.session = new ConnectionSession({
      connectionId: `virtual-${tier}`,
      subject: `anon-${tier}`,
      rateLimiter: new ConnectionRateLimiter({ globalPerSecond: 20, strikeLimit: 3 }),
      maxSubscriptions: 5,
      now: START_TIME,
    });
    // The override is the only lever a client has; autoTier is server-owned.
    this.session.tierOverride = tier;
    for (const symbol of symbols) {
      this.session.subscriptions.set(
        symbol,
        new SymbolSubscription(symbol, ['book', 'trades', 'candles'], interval),
      );
    }
  }

  feed(result: SymbolTickResult, now: number): void {
    const subscription = this.session.subscription(result.symbol);
    if (subscription === undefined) return;
    enqueue(subscription, result);
    this.sent.push(...flushDue(subscription, now, this.session.effectiveTier));
  }

  /**
   * Lets the cadence complete. A MINIMAL client sends every 2 s, so a run that
   * stops mid-window still has a closed candle queued — that is the scheduler
   * working, not a lost candle.
   */
  drain(now: number): void {
    for (const subscription of this.session.subscriptions.values()) {
      this.sent.push(...flushDue(subscription, now, this.session.effectiveTier));
    }
  }

  /** Finalised candles as this client saw them, in arrival order. */
  finalCandles(symbol: MarketSymbol): Candle[] {
    const out: Candle[] = [];
    for (const frame of this.sent) {
      if (frame.type !== 'candles.update' || frame.symbol !== symbol) continue;
      out.push(...frame.candles.filter((candle) => candle.final));
    }
    return out;
  }

  candleFrames(symbol: MarketSymbol): number {
    return this.sent.filter((frame) => frame.type === 'candles.update' && frame.symbol === symbol)
      .length;
  }

  tradeFrames(symbol: MarketSymbol): number {
    return this.sent.filter((frame) => frame.type === 'trades.batch' && frame.symbol === symbol)
      .length;
  }
}

interface Run {
  readonly clients: VirtualClient[];
  /** What the canonical engine finalised, per symbol. */
  readonly canonical: Map<MarketSymbol, Candle[]>;
  readonly trades: Map<MarketSymbol, number>;
  readonly ticks: number;
}

function run(options: {
  readonly symbols: readonly MarketSymbol[];
  readonly clients: VirtualClient[];
  readonly interval: Interval;
  readonly minTrades: number;
}): Run {
  const registry = new SymbolRegistry({
    symbols: options.symbols,
    marketSeed: 1337n,
    bookDepth: 25,
  });
  const engine = new MarketEngine({ registry, tickMs: TICK_MS, startTime: START_TIME });

  const canonical = new Map<MarketSymbol, Candle[]>();
  const trades = new Map<MarketSymbol, number>();
  for (const symbol of options.symbols) {
    canonical.set(symbol, []);
    trades.set(symbol, 0);
  }

  let ticks = 0;
  while (Math.min(...[...trades.values()]) < options.minTrades) {
    ticks += 1;
    // Wall time and logical time advance together: the fake clock.
    const now = START_TIME + ticks * TICK_MS;
    engine.advance((result) => {
      trades.set(result.symbol, (trades.get(result.symbol) ?? 0) + result.trades.length);
      for (const candle of result.finalisedCandles) {
        if (candle.interval === options.interval) {
          canonical.get(result.symbol)?.push(encodeCandle(candle, true));
        }
      }
      for (const client of options.clients) client.feed(result, now);
    });
  }

  const drainAt = START_TIME + (ticks + 100) * TICK_MS;
  for (const client of options.clients) client.drain(drainAt);

  return { clients: options.clients, canonical, trades, ticks };
}

describe('T3 — candle equality across tiers, one symbol', () => {
  const interval: Interval = '1s';
  const symbol: MarketSymbol = 'BTC-USD';
  const full = new VirtualClient('full', [symbol], interval);
  const degraded = new VirtualClient('degraded', [symbol], interval);
  const minimal = new VirtualClient('minimal', [symbol], interval);
  const result = run({
    symbols: [symbol],
    clients: [full, degraded, minimal],
    interval,
    minTrades: 10_000,
  });

  it('drove at least 10,000 deterministic trades', () => {
    expect(result.trades.get(symbol) ?? 0).toBeGreaterThanOrEqual(10_000);
  });

  it('gives FULL, DEGRADED and MINIMAL byte-identical final candles', () => {
    expect(full.finalCandles(symbol)).toEqual(degraded.finalCandles(symbol));
    expect(degraded.finalCandles(symbol)).toEqual(minimal.finalCandles(symbol));
    expect(full.finalCandles(symbol).length).toBeGreaterThan(100);
  });

  it('loses no finalised candle at MINIMAL — equality alone is not enough', () => {
    const canonical = result.canonical.get(symbol) ?? [];
    for (const client of [full, degraded, minimal]) {
      expect(client.finalCandles(symbol), client.tier).toEqual(canonical);
    }
  });

  it('never delivers the same finalised candle twice', () => {
    for (const client of [full, degraded, minimal]) {
      const starts = client.finalCandles(symbol).map((candle) => candle.startTime);
      expect(new Set(starts).size, client.tier).toBe(starts.length);
      expect(starts, client.tier).toEqual([...starts].sort((a, b) => a - b));
    }
  });

  it('double-counts no trade into a candle, at any tier', () => {
    const canonical = result.canonical.get(symbol) ?? [];
    const canonicalCounts = new Map(canonical.map((c) => [c.startTime, c.tradeCount]));
    for (const client of [full, degraded, minimal]) {
      for (const candle of client.finalCandles(symbol)) {
        expect(candle.tradeCount, `${client.tier}@${candle.startTime}`).toBe(
          canonicalCounts.get(candle.startTime),
        );
      }
    }
    // Every trade the engine produced landed in exactly one candle.
    const summed = canonical.reduce((total, candle) => total + candle.tradeCount, 0);
    expect(summed).toBeGreaterThan(9_000);
    expect(summed).toBeLessThanOrEqual(result.trades.get(symbol) ?? 0);
  });

  it('changes only the cadence: frames fall roughly as the tier table says', () => {
    const ratio = (tier: Tier): number =>
      (result.ticks * TICK_MS) / TIER_CADENCE_MS[tier].candlesUpdateMs;

    for (const client of [full, degraded, minimal]) {
      // Never more sends than the cadence permits.
      expect(client.candleFrames(symbol), client.tier).toBeLessThanOrEqual(
        Math.ceil(ratio(client.tier)) + 1,
      );
    }
    expect(full.candleFrames(symbol)).toBeGreaterThan(degraded.candleFrames(symbol));
    expect(degraded.candleFrames(symbol)).toBeGreaterThan(minimal.candleFrames(symbol));
    expect(full.tradeFrames(symbol)).toBeGreaterThan(degraded.tradeFrames(symbol));
    expect(degraded.tradeFrames(symbol)).toBeGreaterThan(minimal.tradeFrames(symbol));
  });
});

describe('T3 — three clients on three different symbols', () => {
  const interval: Interval = '1s';
  const symbols: MarketSymbol[] = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
  const pairs: [MarketSymbol, Tier][] = [
    ['BTC-USD', 'full'],
    ['ETH-USD', 'degraded'],
    ['SOL-USD', 'minimal'],
  ];
  const clients = pairs.map(([symbol, tier]) => new VirtualClient(tier, [symbol], interval));
  const result = run({ symbols, clients, interval, minTrades: 2_000 });

  it('serves each client its own symbol, complete and uncontaminated', () => {
    for (const [index, [symbol]] of pairs.entries()) {
      const client = clients[index];
      expect(client).toBeDefined();
      if (client === undefined) continue;
      expect(client.finalCandles(symbol), symbol).toEqual(result.canonical.get(symbol));
      for (const other of symbols.filter((candidate) => candidate !== symbol)) {
        expect(client.finalCandles(other), `${symbol} leaked ${other}`).toEqual([]);
      }
    }
  });
});

describe('T3 — one connection, three symbols, one tier', () => {
  const interval: Interval = '1s';
  const symbols: MarketSymbol[] = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
  const client = new VirtualClient('minimal', symbols, interval);
  const result = run({ symbols, clients: [client], interval, minTrades: 2_000 });

  it('keeps delivery state per (connection, symbol), not per connection', () => {
    // Keying the scheduler by connection alone would interleave the three
    // symbols' pending queues and lose candles. This is the arrangement that
    // catches it; the single-symbol version cannot.
    for (const symbol of symbols) {
      expect(client.finalCandles(symbol), symbol).toEqual(result.canonical.get(symbol));
      expect(client.finalCandles(symbol).length, symbol).toBeGreaterThan(10);
    }
  });
});
