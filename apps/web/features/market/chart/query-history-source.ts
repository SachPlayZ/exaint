'use client';

import {
  CANDLE_HISTORY_LIMIT_MAX,
  type CandleHistoryResponse,
  type Interval,
} from '@repo/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { candleHistoryQueryOptions } from '../api/queries.js';
import type { MarketRestClient } from '../api/rest-client.js';
import type { CandleHistorySource } from './candle-history-controller.js';

/** TanStack Query-backed history source used by the browser chart pipeline. */
export class QueryCandleHistorySource implements CandleHistorySource {
  readonly #queryClient: QueryClient;
  readonly #restClient: MarketRestClient;
  readonly #limit: number;

  constructor(
    queryClient: QueryClient,
    restClient: MarketRestClient,
    limit = CANDLE_HISTORY_LIMIT_MAX,
  ) {
    this.#queryClient = queryClient;
    this.#restClient = restClient;
    this.#limit = limit;
  }

  async fetch(
    symbol: string,
    interval: Interval,
    signal: AbortSignal,
  ): Promise<CandleHistoryResponse> {
    if (signal.aborted) throw new DOMException('history request aborted', 'AbortError');
    const options = candleHistoryQueryOptions(this.#restClient, symbol, interval, this.#limit);
    const cancel = (): void => {
      void this.#queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await this.#queryClient.fetchQuery(options);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
}
