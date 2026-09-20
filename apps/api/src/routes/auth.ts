import type { TicketResponse } from '@repo/protocol';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app/context.js';
import { METRIC } from '../observability/metrics.js';
import { TicketService } from '../auth/ticket-service.js';

/** 60 requests per minute per IP (docs/01-protocol.md §4). */
const TICKET_RATE_LIMIT = { max: 60, timeWindow: '1 minute' } as const;

export function registerAuthRoutes(server: FastifyInstance, context: AppContext): void {
  server.post(
    '/v1/auth/ticket',
    { config: { rateLimit: TICKET_RATE_LIMIT } },
    async (_request, reply) => {
      const service = context.tickets;

      // AUTH_MODE=off still mints, so the client's connect flow is identical in
      // local development; the gateway is what stops checking (docs/01 §7).
      if (service === null) {
        const expiresAt = Date.now() + context.auth.ttlMs;
        const body: TicketResponse = {
          ticket: `${Buffer.from(
            JSON.stringify({ sub: TicketService.mintSubject(), iat: Date.now(), exp: expiresAt }),
          ).toString('base64url')}.disabled`,
          expiresAt,
        };
        context.metrics.increment(METRIC.authTicketsIssued);
        return reply.send(body);
      }

      const minted = service.mint();
      context.metrics.increment(METRIC.authTicketsIssued);
      // Never log the ticket value — log its subject (docs/06-ops-deploy.md §5).
      reply.log.info({ event: 'auth.ticket_issued', sub: minted.subject }, 'ticket issued');

      const body: TicketResponse = { ticket: minted.ticket, expiresAt: minted.expiresAt };
      return reply.send(body);
    },
  );
}
