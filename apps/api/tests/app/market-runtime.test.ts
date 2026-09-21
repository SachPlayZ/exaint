import { describe, expect, it } from 'vitest';
import { MarketRuntime } from '../../src/app/market-runtime.js';
import { loadAuthConfig, loadHttpConfig, loadMarketConfig } from '../../src/config/env.js';
import { MarketEngine } from '../../src/market/market-engine.js';
import { DEFAULT_SYMBOLS } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';
import { METRIC, createMetricsRegistry } from '../../src/observability/metrics.js';

const START = 1_700_000_000_000;

function buildRuntime(maxCatchUpTicks = 200) {
  const registry = new SymbolRegistry({
    symbols: DEFAULT_SYMBOLS,
    marketSeed: 1337n,
    bookDepth: 25,
  });
  const engine = new MarketEngine({ registry, tickMs: 50, startTime: START });
  const metrics = createMetricsRegistry();
  return { runtime: new MarketRuntime({ engine, metrics, maxCatchUpTicks }), engine, metrics };
}

describe('MarketRuntime', () => {
  it('bounds one catch-up pass without skipping a single tick', () => {
    const { runtime, engine } = buildRuntime(200);
    // A 60 s freeze owes 1200 ticks.
    const wall = START + 60_000;

    expect(runtime.pump(wall)).toBe(200);
    expect(engine.clock.tick).toBe(200);
    expect(runtime.pump(wall)).toBe(200);
    expect(engine.clock.tick).toBe(400);

    let passes = 2;
    while (engine.clock.owedTicks(wall) > 0) {
      runtime.pump(wall);
      passes += 1;
    }
    expect(engine.clock.tick).toBe(1_200);
    expect(passes).toBe(6);
  });

  it('feeds symbol-labelled counters as the market runs', () => {
    const { runtime, metrics } = buildRuntime();
    runtime.pump(START + 10_000);
    for (const symbol of DEFAULT_SYMBOLS) {
      expect(metrics.read(METRIC.tradesGenerated, { symbol }), symbol).toBeGreaterThan(0);
      expect(metrics.read(METRIC.bookSequence, { symbol }), symbol).toBeGreaterThan(0);
      expect(metrics.read(METRIC.candleUpdatesGenerated, { symbol }), symbol).toBeGreaterThan(0);
    }
  });

  it('hands every tick to its listeners and stops when unsubscribed', () => {
    const { runtime } = buildRuntime();
    let seen = 0;
    const unsubscribe = runtime.subscribe(() => {
      seen += 1;
    });
    runtime.pump(START + 500);
    expect(seen).toBe(10 * DEFAULT_SYMBOLS.length);

    unsubscribe();
    runtime.pump(START + 1_000);
    expect(seen).toBe(10 * DEFAULT_SYMBOLS.length);
  });
});

describe('configuration', () => {
  it('defaults the catch-up bound and reads it from the environment', () => {
    expect(loadMarketConfig({}).maxCatchUpTicks).toBe(200);
    expect(loadMarketConfig({ MARKET_MAX_CATCHUP_TICKS: '50' }).maxCatchUpTicks).toBe(50);
    expect(() => loadMarketConfig({ MARKET_MAX_CATCHUP_TICKS: '0' })).toThrow(/CATCHUP/);
  });

  it('requires a real secret in production and mints an ephemeral one locally', () => {
    expect(() => loadAuthConfig({ AUTH_MODE: 'ticket', NODE_ENV: 'production' })).toThrow(
      /AUTH_TICKET_SECRET/,
    );

    // Locally a stranger must be able to clone, install and run without setup.
    const local = loadAuthConfig({ AUTH_MODE: 'ticket' });
    expect(local.secret.length).toBeGreaterThan(20);
    expect(loadAuthConfig({ AUTH_MODE: 'ticket' }).secret).not.toBe(local.secret);

    expect(loadAuthConfig({ AUTH_MODE: 'off' })).toMatchObject({ mode: 'off', ttlMs: 60_000 });
    expect(loadAuthConfig({ AUTH_MODE: 'ticket', AUTH_TICKET_SECRET: 's' }).secret).toBe('s');
    expect(() => loadAuthConfig({ AUTH_MODE: 'maybe' })).toThrow(/AUTH_MODE/);
  });

  it('parses ALLOWED_ORIGINS and gates the debug controls', () => {
    expect(loadHttpConfig({}).allowedOrigins).toEqual(['http://localhost:3000']);
    expect(
      loadHttpConfig({ ALLOWED_ORIGINS: 'https://a.example, https://b.example' }).allowedOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
    expect(loadHttpConfig({}).enableDebugControls).toBe(false);
    expect(loadHttpConfig({ ENABLE_DEBUG_CONTROLS: 'true' }).enableDebugControls).toBe(true);
    expect(loadHttpConfig({}).trustProxy).toBe(false);
    expect(loadHttpConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(() => loadHttpConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
    expect(() => loadHttpConfig({ ALLOWED_ORIGINS: ' , ' })).toThrow(/ALLOWED_ORIGINS/);
  });
});
