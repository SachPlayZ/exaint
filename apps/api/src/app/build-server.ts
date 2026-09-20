import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';
import type { MarketRuntime } from './market-runtime.js';
import { registerWebSocketGateway, type GatewayOptions } from '../websocket/gateway.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerHealthRoutes } from '../routes/health.js';
import { registerMarketRoutes } from '../routes/markets.js';

/**
 * Builds the Fastify instance without listening, so tests can drive it
 * in-process against a deterministic engine.
 */
export async function buildServer(
  context: AppContext,
  runtime: MarketRuntime,
  gateway: GatewayOptions = {},
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      // Structured JSON lines — docs/06-ops-deploy.md §5.
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  await server.register(cors, {
    origin: [...context.http.allowedOrigins],
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await server.register(rateLimit, {
    // Opt-in per route: health and metrics must never be throttled.
    global: false,
    errorResponseBuilder: (_request, limit) => {
      // The plugin throws whatever this returns, so the shape travels through
      // the error handler below rather than being sent directly.
      const error = new Error('rate limited') as Error & {
        statusCode: number;
        code: string;
        retryAfterMs: number;
      };
      error.statusCode = 429;
      error.code = 'RATE_LIMITED';
      error.retryAfterMs = Math.max(0, Math.round(limit.ttl));
      throw error;
    },
  });

  /**
   * Errors are values at the edge: a rate-limited or malformed request produces
   * a documented `{ code }` body and never a stack trace (AGENTS.md §5).
   */
  server.setErrorHandler((error: FastifyError & { retryAfterMs?: number }, request, reply) => {
    if (error.code === 'RATE_LIMITED') {
      return reply.code(429).send({ code: 'RATE_LIMITED', retryAfterMs: error.retryAfterMs ?? 0 });
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ code: 'INVALID_MESSAGE', message: error.message });
    }
    request.log.error({ event: 'request.failed', err: error }, 'unhandled request error');
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });

  registerHealthRoutes(server, context);
  registerMarketRoutes(server, context);
  registerAuthRoutes(server, context);
  await registerWebSocketGateway(server, context, runtime, gateway);

  server.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ code: 'UNKNOWN_SYMBOL', message: 'no such route' }),
  );

  return server;
}
