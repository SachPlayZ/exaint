import { randomBytes } from 'node:crypto';
import type { MarketSymbol } from '@repo/protocol';
import { DEFAULT_SYMBOLS, SYMBOL_CONFIG_BY_SYMBOL } from '../market/symbol-config.js';

/**
 * Process configuration. Each phase adds the vars it introduces and records them
 * in docs/06-ops-deploy.md §3.
 */
export interface ServerConfig {
  readonly host: string;
  readonly port: number;
}

export interface MarketConfig {
  readonly symbols: readonly MarketSymbol[];
  readonly seed: bigint;
  readonly bookDepth: number;
  readonly tickMs: number;
  /** Ticks one catch-up pass may run, so a stall cannot block the event loop. */
  readonly maxCatchUpTicks: number;
}

export type AuthMode = 'ticket' | 'off';

export interface AuthConfig {
  readonly mode: AuthMode;
  readonly secret: string;
  readonly ttlMs: number;
}

export interface HttpConfig {
  readonly allowedOrigins: readonly string[];
  readonly enableDebugControls: boolean;
}

export interface WebSocketConfig {
  readonly globalFramesPerSecond: number;
  readonly strikeLimit: number;
  readonly maxSubscriptions: number;
  readonly maxFrameBytes: number;
}

function readInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}, received "${raw}"`,
    );
  }
  return parsed;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    // 0.0.0.0 so the container port mapping works; see docs/06-ops-deploy.md §4.
    host: env.HOST ?? '0.0.0.0',
    port: readInteger('PORT', env.PORT, 8080, { min: 1, max: 65535 }),
  };
}

export function loadMarketConfig(env: NodeJS.ProcessEnv = process.env): MarketConfig {
  const rawSymbols = env.MARKET_SYMBOLS;
  const symbols =
    rawSymbols === undefined || rawSymbols === ''
      ? DEFAULT_SYMBOLS
      : rawSymbols
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

  for (const symbol of symbols) {
    if (!SYMBOL_CONFIG_BY_SYMBOL.has(symbol)) {
      throw new Error(`MARKET_SYMBOLS contains "${symbol}", which has no registry entry`);
    }
  }
  if (symbols.length === 0) {
    throw new Error('MARKET_SYMBOLS must list at least one symbol');
  }

  const rawSeed = env.MARKET_SEED;
  let seed: bigint;
  try {
    seed = rawSeed === undefined || rawSeed === '' ? 1337n : BigInt(rawSeed);
  } catch {
    throw new Error(`MARKET_SEED must be an integer, received "${rawSeed}"`);
  }

  return {
    symbols,
    seed,
    bookDepth: readInteger('MARKET_BOOK_DEPTH', env.MARKET_BOOK_DEPTH, 25, { min: 1, max: 500 }),
    tickMs: readInteger('MARKET_TICK_MS', env.MARKET_TICK_MS, 50, { min: 1, max: 10_000 }),
    maxCatchUpTicks: readInteger('MARKET_MAX_CATCHUP_TICKS', env.MARKET_MAX_CATCHUP_TICKS, 200, {
      min: 1,
      max: 100_000,
    }),
  };
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const rawMode = env.AUTH_MODE ?? 'ticket';
  if (rawMode !== 'ticket' && rawMode !== 'off') {
    throw new Error(`AUTH_MODE must be "ticket" or "off", received "${rawMode}"`);
  }

  let secret = env.AUTH_TICKET_SECRET ?? '';
  if (rawMode === 'ticket' && secret === '') {
    // A stranger must be able to clone, install, and run (docs/06-ops-deploy.md §1),
    // so outside production we mint an ephemeral per-process secret rather than
    // refusing to boot. Every deployed environment still has to supply a real one.
    if (env.NODE_ENV === 'production') {
      throw new Error('AUTH_TICKET_SECRET is required when AUTH_MODE=ticket');
    }
    secret = randomBytes(32).toString('base64url');
  }

  return {
    mode: rawMode,
    secret,
    ttlMs: readInteger('AUTH_TICKET_TTL_MS', env.AUTH_TICKET_TTL_MS, 60_000, {
      min: 1_000,
      max: 3_600_000,
    }),
  };
}

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const raw = env.ALLOWED_ORIGINS ?? 'http://localhost:3000';
  const allowedOrigins = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must list at least one origin');
  }
  return {
    allowedOrigins,
    enableDebugControls: (env.ENABLE_DEBUG_CONTROLS ?? 'false') === 'true',
  };
}

export function loadWebSocketConfig(env: NodeJS.ProcessEnv = process.env): WebSocketConfig {
  return {
    globalFramesPerSecond: readInteger(
      'RATE_LIMIT_GLOBAL_PER_SEC',
      env.RATE_LIMIT_GLOBAL_PER_SEC,
      20,
      { min: 1, max: 10_000 },
    ),
    strikeLimit: readInteger('RATE_LIMIT_STRIKES', env.RATE_LIMIT_STRIKES, 3, { min: 1, max: 100 }),
    maxSubscriptions: readInteger('MAX_SUBSCRIPTIONS_PER_CONN', env.MAX_SUBSCRIPTIONS_PER_CONN, 5, {
      min: 1,
      max: 100,
    }),
    maxFrameBytes: readInteger('MAX_FRAME_BYTES', env.MAX_FRAME_BYTES, 8_192, {
      min: 256,
      max: 1_048_576,
    }),
  };
}
