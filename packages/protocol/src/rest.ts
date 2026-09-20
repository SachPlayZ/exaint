import { z } from 'zod';
import { ErrorCodeSchema, TicketSchema } from './auth.js';
import {
  BookSnapshotSchema,
  CandleSchema,
  IntervalSchema,
  MarketSummarySchema,
  SymbolSchema,
  TimestampSchema,
} from './market.js';

/**
 * REST request params and response shapes. Base path `/v1`.
 * See docs/01-protocol.md §4.
 */

/** Largest `limit` the candle history endpoint will serve; requests above it are clamped. */
export const CANDLE_HISTORY_LIMIT_MAX = 300;
export const CANDLE_HISTORY_LIMIT_DEFAULT = 300;

// ---------------------------------------------------------------------------
// Request params
// ---------------------------------------------------------------------------

export const SymbolParamsSchema = z.object({
  symbol: SymbolSchema,
});
export type SymbolParams = z.infer<typeof SymbolParamsSchema>;

/**
 * `?interval=1s&limit=300`. Query values arrive as strings, so `limit` is
 * coerced, then clamped to `[1, CANDLE_HISTORY_LIMIT_MAX]` rather than rejected —
 * an over-large `limit` is a client being optimistic, not a protocol violation.
 */
export const CandleHistoryQuerySchema = z.object({
  interval: IntervalSchema,
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(CANDLE_HISTORY_LIMIT_DEFAULT)
    .transform((value) => Math.min(value, CANDLE_HISTORY_LIMIT_MAX)),
});
export type CandleHistoryQuery = z.infer<typeof CandleHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const TicketResponseSchema = z.object({
  ticket: TicketSchema,
  expiresAt: TimestampSchema,
});
export type TicketResponse = z.infer<typeof TicketResponseSchema>;

export const MarketsResponseSchema = z.object({
  serverTime: TimestampSchema,
  symbols: z.array(MarketSummarySchema),
});
export type MarketsResponse = z.infer<typeof MarketsResponseSchema>;

/** Snapshot plus the sequence it was taken at — the anchor for client sync. */
export const BookSnapshotResponseSchema = BookSnapshotSchema;
export type BookSnapshotResponse = z.infer<typeof BookSnapshotResponseSchema>;

/**
 * Completed history **plus** the canonical current candle, the last one marked
 * `final: false`. Ascending by `startTime`, unique by `startTime`.
 */
export const CandleHistoryResponseSchema = z.object({
  symbol: SymbolSchema,
  interval: IntervalSchema,
  serverTime: TimestampSchema,
  candles: z.array(CandleSchema),
});
export type CandleHistoryResponse = z.infer<typeof CandleHistoryResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Ready only once **every** symbol engine has produced its first tick. */
export const ReadyResponseSchema = z.object({
  ready: z.boolean(),
  pendingSymbols: z.array(SymbolSchema),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

/**
 * REST can also fail in a way the socket cannot: an unhandled server error.
 * `INTERNAL_ERROR` exists only here — it is never a frame code.
 */
export const RestErrorCodeSchema = z.union([ErrorCodeSchema, z.literal('INTERNAL_ERROR')]);
export type RestErrorCode = z.infer<typeof RestErrorCodeSchema>;

export const RestErrorResponseSchema = z.object({
  code: RestErrorCodeSchema,
  message: z.string().optional(),
  /** Present on `429 RATE_LIMITED`. */
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type RestErrorResponse = z.infer<typeof RestErrorResponseSchema>;
