import { TicketService } from '../auth/ticket-service.js';
import {
  loadAuthConfig,
  loadHttpConfig,
  loadMarketConfig,
  loadWebSocketConfig,
} from '../config/env.js';
import { MarketEngine } from '../market/market-engine.js';
import { MarketRepository } from '../market/market-repository.js';
import { SymbolRegistry } from '../market/symbol-registry.js';
import { createMetricsRegistry } from '../observability/metrics.js';
import type { AppContext } from './context.js';
import { MarketRuntime } from './market-runtime.js';

export interface Application {
  readonly context: AppContext;
  readonly runtime: MarketRuntime;
}

/**
 * Wires configuration into a running market plus the context the transport
 * layer reads from. Dependency direction stays one-way: nothing below knows
 * Fastify exists (docs/00-architecture.md §3).
 */
export function createApplication(env: NodeJS.ProcessEnv = process.env): Application {
  const market = loadMarketConfig(env);
  const auth = loadAuthConfig(env);
  const http = loadHttpConfig(env);
  const websocket = loadWebSocketConfig(env);

  const registry = new SymbolRegistry({
    symbols: market.symbols,
    marketSeed: market.seed,
    bookDepth: market.bookDepth,
  });
  const engine = new MarketEngine({
    registry,
    tickMs: market.tickMs,
    // Demo mode separates the two axes: timestamps track the process start,
    // price movement stays reproducible from the seed (docs/02 §3).
    startTime: Date.now(),
  });
  const metrics = createMetricsRegistry();

  return {
    context: {
      repository: new MarketRepository(registry),
      metrics,
      tickets:
        auth.mode === 'ticket'
          ? new TicketService({ secret: auth.secret, ttlMs: auth.ttlMs })
          : null,
      auth,
      http,
      websocket,
    },
    runtime: new MarketRuntime({ engine, metrics, maxCatchUpTicks: market.maxCatchUpTicks }),
  };
}
