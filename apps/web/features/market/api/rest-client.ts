import type {
  BookSnapshotResponse,
  CandleHistoryResponse,
  Interval,
  MarketsResponse,
  TicketResponse,
} from '@repo/protocol';
import {
  BookSnapshotResponseSchema,
  CandleHistoryResponseSchema,
  MarketsResponseSchema,
  RestErrorResponseSchema,
  TicketResponseSchema,
} from '@repo/protocol';
import type { z } from 'zod';

/**
 * REST access. Every response is parsed with the shared schema before it reaches
 * the app — the boundary is where we find out the server sent something else,
 * not three components later (AGENTS.md §5).
 */

export class RestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? `${code} (${status})`);
    this.name = 'RestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = RestErrorResponseSchema.safeParse(body);
    throw new RestError(
      response.status,
      parsed.success ? parsed.data.code : 'INVALID_MESSAGE',
      parsed.success ? parsed.data.message : undefined,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RestError(response.status, 'INVALID_MESSAGE', `unexpected response from ${url}`);
  }
  return parsed.data;
}

export class MarketRestClient {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Tickets are single-use and live 60 s. Fetched fresh per connect attempt,
   * held in a variable, never in `localStorage` (docs/04-frontend.md §4).
   */
  async fetchTicket(signal?: AbortSignal): Promise<TicketResponse> {
    return request(`${this.#baseUrl}/v1/auth/ticket`, TicketResponseSchema, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async fetchMarkets(signal?: AbortSignal): Promise<MarketsResponse> {
    return request(`${this.#baseUrl}/v1/markets`, MarketsResponseSchema, {
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async fetchBookSnapshot(symbol: string, signal?: AbortSignal): Promise<BookSnapshotResponse> {
    return request(
      `${this.#baseUrl}/v1/markets/${encodeURIComponent(symbol)}/book`,
      BookSnapshotResponseSchema,
      { ...(signal === undefined ? {} : { signal }) },
    );
  }

  async fetchCandles(
    symbol: string,
    interval: Interval,
    limit: number,
    signal?: AbortSignal,
  ): Promise<CandleHistoryResponse> {
    const query = new URLSearchParams({ interval, limit: String(limit) });
    return request(
      `${this.#baseUrl}/v1/markets/${encodeURIComponent(symbol)}/candles?${query.toString()}`,
      CandleHistoryResponseSchema,
      { ...(signal === undefined ? {} : { signal }) },
    );
  }
}
