import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/app/build-server.js';
import type { AppContext } from '../../src/app/context.js';
import { MarketRuntime } from '../../src/app/market-runtime.js';
import { TicketService } from '../../src/auth/ticket-service.js';
import { MarketEngine } from '../../src/market/market-engine.js';
import { MarketRepository } from '../../src/market/market-repository.js';
import { DEFAULT_SYMBOLS } from '../../src/market/symbol-config.js';
import { SymbolRegistry } from '../../src/market/symbol-registry.js';
import { createMetricsRegistry } from '../../src/observability/metrics.js';

export const TEST_START_TIME = 1_700_000_000_000;
export const TEST_SECRET = 'test-secret-not-used-anywhere-real';

export interface TestApp {
  readonly server: FastifyInstance;
  /** Starts listening and returns the `ws://` base URL for the gateway. */
  listen(): Promise<string>;
  readonly context: AppContext;
  readonly runtime: MarketRuntime;
  readonly registry: SymbolRegistry;
  /** Advances the market by `ticks` logical ticks. No timers, no sleeping. */
  pump(ticks: number): void;
  /** Advances the connection clock without running the market. */
  advanceClock(ms: number): void;
  close(): Promise<void>;
}

/** A server wired to a deterministic market, driven by hand rather than a timer. */
export async function createTestApp(
  options: {
    readonly authMode?: 'ticket' | 'off';
    readonly ticketTtlMs?: number;
    readonly ticketNow?: () => number;
    readonly enableDebugControls?: boolean;
    readonly maxSubscriptions?: number;
    readonly heartbeatTimeoutMs?: number;
    readonly heartbeatCheckMs?: number;
  } = {},
): Promise<TestApp> {
  const registry = new SymbolRegistry({
    symbols: DEFAULT_SYMBOLS,
    marketSeed: 1337n,
    bookDepth: 25,
  });
  const engine = new MarketEngine({ registry, tickMs: 50, startTime: TEST_START_TIME });
  const metrics = createMetricsRegistry();
  const runtime = new MarketRuntime({ engine, metrics, maxCatchUpTicks: 200 });
  const ttlMs = options.ticketTtlMs ?? 60_000;

  const context: AppContext = {
    repository: new MarketRepository(registry),
    metrics,
    tickets:
      (options.authMode ?? 'ticket') === 'ticket'
        ? new TicketService({ secret: TEST_SECRET, ttlMs, now: options.ticketNow })
        : null,
    auth: { mode: options.authMode ?? 'ticket', secret: TEST_SECRET, ttlMs },
    http: {
      allowedOrigins: ['http://localhost:3000'],
      enableDebugControls: options.enableDebugControls ?? true,
    },
    websocket: {
      globalFramesPerSecond: 20,
      strikeLimit: 3,
      maxSubscriptions: options.maxSubscriptions ?? 5,
      maxFrameBytes: 8_192,
    },
  };

  // Every per-connection time decision — cadence, token buckets, heartbeat,
  // missing-report ladder — reads this clock. Tests advance it explicitly, so
  // nothing here depends on how fast the machine happens to be.
  const clockBase = Date.now();
  const clock = { value: clockBase };
  const server = await buildServer(context, runtime, {
    now: () => clock.value,
    ...(options.heartbeatTimeoutMs === undefined
      ? {}
      : { heartbeatTimeoutMs: options.heartbeatTimeoutMs }),
    ...(options.heartbeatCheckMs === undefined
      ? {}
      : { heartbeatCheckMs: options.heartbeatCheckMs }),
  });
  await server.ready();

  return {
    server,
    async listen(): Promise<string> {
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      return `${address.replace('http://', 'ws://')}/v1/ws`;
    },
    context,
    runtime,
    registry,
    pump(ticks: number): void {
      // One tick at a time, so the scheduler sees wall time advance the way it
      // would in production rather than a single instant.
      for (let tick = 0; tick < ticks; tick += 1) {
        const logicalAt = TEST_START_TIME + (engine.clock.tick + 1) * 50;
        clock.value = clockBase + (engine.clock.tick + 1) * 50;
        runtime.pump(logicalAt);
      }
    },
    advanceClock(ms: number): void {
      clock.value += ms;
    },
    async close(): Promise<void> {
      runtime.stop();
      await server.close();
    },
  };
}
