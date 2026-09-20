import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Builds the Fastify instance without listening, so tests can drive it in-process.
 *
 * P0 registers nothing: REST routes arrive in P4, the WebSocket gateway in P5.
 * See docs/00-architecture.md §4 for the module inventory this grows into.
 */
export function buildServer(): FastifyInstance {
  return Fastify({
    logger: {
      // Structured JSON lines — docs/06-ops-deploy.md §5.
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });
}
