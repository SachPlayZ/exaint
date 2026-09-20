import type { HealthResponse, ReadyResponse } from '@repo/protocol';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app/context.js';

/**
 * Liveness, readiness and metrics. None of these are rate limited — a monitor
 * that gets throttled is worse than useless (docs/01-protocol.md §4).
 */
export function registerHealthRoutes(server: FastifyInstance, context: AppContext): void {
  server.get('/healthz', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  server.get('/readyz', async (_request, reply) => {
    const pendingSymbols = context.repository.pendingSymbols();
    const body: ReadyResponse = { ready: pendingSymbols.length === 0, pendingSymbols };
    // Not ready is not an error, but it must not read as healthy to a load balancer.
    return reply.code(body.ready ? 200 : 503).send(body);
  });

  server.get('/metrics', async (_request, reply) =>
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(context.metrics.render()),
  );
}
