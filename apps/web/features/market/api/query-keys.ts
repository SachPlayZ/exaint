import type { Interval } from '@repo/protocol';

/**
 * Query keys carry **both** symbol and interval, so a switch cancels the
 * in-flight request instead of letting it land on the wrong market
 * (docs/04-frontend.md §6, §7).
 */
export const queryKeys = {
  markets: () => ['markets'] as const,
  book: (symbol: string) => ['book', symbol] as const,
  candles: (symbol: string, interval: Interval, limit: number) =>
    ['candles', symbol, interval, limit] as const,
} as const;
