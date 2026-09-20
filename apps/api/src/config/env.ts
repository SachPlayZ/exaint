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
  };
}
