import type { CandleHistoryResponse, MarketsResponse } from '@repo/protocol';
import { CandleHistoryQuerySchema, SymbolParamsSchema } from '@repo/protocol';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app/context.js';
import { sendError } from './errors.js';

/** 120 requests per minute per IP for market reads (docs/01-protocol.md §4). */
const MARKET_READ_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const;

export function registerMarketRoutes(server: FastifyInstance, context: AppContext): void {
  server.get(
    '/v1/markets',
    { config: { rateLimit: MARKET_READ_RATE_LIMIT } },
    async (): Promise<MarketsResponse> => ({
      serverTime: Date.now(),
      symbols: context.repository.markets(),
    }),
  );

  server.get(
    '/v1/markets/:symbol/book',
    { config: { rateLimit: MARKET_READ_RATE_LIMIT } },
    async (request, reply) => {
      const params = SymbolParamsSchema.safeParse(request.params);
      if (!params.success) return sendError(reply, 'UNKNOWN_SYMBOL');

      const snapshot = context.repository.bookSnapshot(params.data.symbol);
      if (snapshot === undefined) return sendError(reply, 'UNKNOWN_SYMBOL');
      return reply.send(snapshot);
    },
  );

  server.get(
    '/v1/markets/:symbol/candles',
    { config: { rateLimit: MARKET_READ_RATE_LIMIT } },
    async (request, reply) => {
      const params = SymbolParamsSchema.safeParse(request.params);
      if (!params.success) return sendError(reply, 'UNKNOWN_SYMBOL');

      const query = CandleHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        // The field that broke decides the code, exactly as on the socket.
        const brokeOnInterval = query.error.issues.some((issue) => issue.path[0] === 'interval');
        return sendError(reply, brokeOnInterval ? 'INVALID_INTERVAL' : 'INVALID_MESSAGE');
      }

      const candles = context.repository.candles(
        params.data.symbol,
        query.data.interval,
        query.data.limit,
      );
      if (candles === undefined) return sendError(reply, 'UNKNOWN_SYMBOL');

      const body: CandleHistoryResponse = {
        symbol: params.data.symbol,
        interval: query.data.interval,
        serverTime: Date.now(),
        candles,
      };
      return reply.send(body);
    },
  );
}
