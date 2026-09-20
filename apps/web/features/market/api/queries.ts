'use client';

import type { Interval } from '@repo/protocol';
import { CANDLE_HISTORY_LIMIT_MAX } from '@repo/protocol';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MarketsResponse, BookSnapshotResponse, CandleHistoryResponse } from '@repo/protocol';
import { MarketRestClient } from './rest-client';
import { queryKeys } from './query-keys';

/**
 * REST server state (docs/04-frontend.md §8). TanStack Query owns fetching,
 * caching and cancellation; Zustand never sees any of it.
 */

export function createRestClient(): MarketRestClient {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
  return new MarketRestClient(baseUrl);
}

export function useMarkets(client: MarketRestClient): UseQueryResult<MarketsResponse> {
  return useQuery({
    queryKey: queryKeys.markets(),
    // The symbol list is driven from here, never hardcoded in the frontend.
    queryFn: ({ signal }) => client.fetchMarkets(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useBookSnapshot(
  client: MarketRestClient,
  symbol: string,
  enabled = true,
): UseQueryResult<BookSnapshotResponse> {
  return useQuery({
    queryKey: queryKeys.book(symbol),
    queryFn: ({ signal }) => client.fetchBookSnapshot(symbol, signal),
    enabled,
    // Snapshot once, then deltas. Never poll the book on a timer.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  });
}

export function useCandleHistory(
  client: MarketRestClient,
  symbol: string,
  interval: Interval,
  limit: number = CANDLE_HISTORY_LIMIT_MAX,
): UseQueryResult<CandleHistoryResponse> {
  return useQuery(candleHistoryQueryOptions(client, symbol, interval, limit));
}

export function candleHistoryQueryOptions(
  client: MarketRestClient,
  symbol: string,
  interval: Interval,
  limit: number = CANDLE_HISTORY_LIMIT_MAX,
) {
  return queryOptions({
    queryKey: queryKeys.candles(symbol, interval, limit),
    queryFn: ({ signal }) => client.fetchCandles(symbol, interval, limit, signal),
    // Switching back to a cached scope still needs the latest canonical history.
    staleTime: 0,
  });
}
