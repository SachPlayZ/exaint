import { z } from 'zod';
import { TimestampSchema } from './market.js';

/**
 * Connect tickets, error codes, and close codes.
 * See docs/01-protocol.md §5 (codes) and §7 (authentication).
 */

// ---------------------------------------------------------------------------
// Connect ticket
// ---------------------------------------------------------------------------

/**
 * Ticket payload, signed as
 * `base64url(payload) "." base64url(HMAC-SHA256(payload, AUTH_TICKET_SECRET))`.
 *
 * `sub` is an opaque anonymous id minted per request and used as the rate-limit
 * key. It is not a user, and nothing is stored about it.
 */
export const TicketPayloadSchema = z.object({
  sub: z.string().min(1).max(64),
  iat: TimestampSchema,
  exp: TimestampSchema,
});
export type TicketPayload = z.infer<typeof TicketPayloadSchema>;

/** `<base64url payload>.<base64url signature>` — never logged, never cached. */
export const TicketSchema = z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ErrorCodeSchema = z.enum([
  /** Failed schema validation. */
  'INVALID_MESSAGE',
  /** `type` not in the client set. */
  'UNKNOWN_TYPE',
  /** Symbol not in `MARKET_SYMBOLS`. */
  'UNKNOWN_SYMBOL',
  /** Interval not in `1s | 5s | 1m`. */
  'INVALID_INTERVAL',
  /** Channel not in `book | trades | candles`. */
  'INVALID_CHANNEL',
  /** `set_interval` for a symbol this connection has not subscribed to. */
  'NOT_SUBSCRIBED',
  /** Per-connection symbol cap exceeded. */
  'TOO_MANY_SUBSCRIPTIONS',
  /** Frame dropped by the rate limiter. */
  'RATE_LIMITED',
  /** Ticket missing, malformed, or signature invalid. */
  'UNAUTHORIZED',
  /** Ticket past `exp`, or already used. */
  'TICKET_EXPIRED',
  /** Outbound book stream unrecoverable — socket closing, resync on reconnect. */
  'BACKPRESSURE_CLOSE',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------------------
// Close codes
// ---------------------------------------------------------------------------

/**
 * WebSocket close statuses, so the client can react without parsing a frame.
 * An `error` frame is always sent *before* the close, so the reason is visible
 * in both places.
 */
export const CLOSE_CODES = Object.freeze({
  /** Unauthorized — fetch a new ticket, then reconnect. */
  UNAUTHORIZED: 4401,
  /** Ticket expired or replayed — fetch a new ticket, then reconnect. */
  TICKET_EXPIRED: 4408,
  /** Rate-limit abuse — reconnect with backoff, do not retry immediately. */
  RATE_LIMITED: 4429,
  /** Backpressure close — reconnect and take a fresh snapshot. */
  BACKPRESSURE: 4409,
  /** Heartbeat timeout (45 s) — normal reconnect. */
  HEARTBEAT_TIMEOUT: 4000,
} as const);

export type CloseCodeName = keyof typeof CLOSE_CODES;
export type CloseCode = (typeof CLOSE_CODES)[CloseCodeName];

const CLOSE_CODE_VALUES = new Set<number>(Object.values(CLOSE_CODES));

export function isProtocolCloseCode(code: number): code is CloseCode {
  return CLOSE_CODE_VALUES.has(code);
}
