import type { ErrorCode } from '@repo/protocol';
import type { FastifyReply } from 'fastify';

/**
 * HTTP status for each error code the REST surface can produce.
 * Recorded in docs/01-protocol.md §4 so the client is not guessing.
 */
export const STATUS_FOR_CODE: Partial<Record<ErrorCode, number>> = {
  INVALID_MESSAGE: 400,
  INVALID_INTERVAL: 400,
  UNKNOWN_SYMBOL: 404,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  TICKET_EXPIRED: 401,
};

/** Errors are values at the edge — a bad request never throws out of a handler. */
export function sendError(reply: FastifyReply, code: ErrorCode, message?: string): FastifyReply {
  const status = STATUS_FOR_CODE[code] ?? 400;
  return reply.code(status).send(message === undefined ? { code } : { code, message });
}
