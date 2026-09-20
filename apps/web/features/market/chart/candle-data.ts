import type { Candle, Interval } from '@repo/protocol';
import { parseIdentifier } from '@repo/protocol';

export interface CandleScope {
  readonly symbol: string;
  readonly interval: Interval;
  readonly tickSize: string;
}

function key(scope: Pick<CandleScope, 'symbol' | 'interval'>, candle: Candle): string {
  return `${scope.symbol}\u0000${scope.interval}\u0000${candle.startTime}`;
}

function isNewer(candidate: Candle, current: Candle): boolean {
  const candidateId = parseIdentifier(candidate.lastTradeId);
  const currentId = parseIdentifier(current.lastTradeId);
  return (
    candidateId > currentId || (candidateId === currentId && candidate.final && !current.final)
  );
}

/**
 * Joins REST history with candles buffered while that request was in flight.
 * Identity includes symbol and interval; revisions resolve by `lastTradeId`,
 * never timestamp or arrival order (I3).
 */
export function mergeCandles(
  scope: Pick<CandleScope, 'symbol' | 'interval'>,
  history: readonly Candle[],
  live: readonly Candle[],
): Candle[] {
  const merged = new Map<string, Candle>();

  for (const candle of [...history, ...live]) {
    if (candle.symbol !== scope.symbol) continue;
    const candleKey = key(scope, candle);
    const current = merged.get(candleKey);
    if (current === undefined || isNewer(candle, current)) merged.set(candleKey, candle);
  }

  return [...merged.values()].sort((left, right) => left.startTime - right.startTime);
}

export function isCandleNewer(candidate: Candle, current: Candle | undefined): boolean {
  return current === undefined || isNewer(candidate, current);
}
