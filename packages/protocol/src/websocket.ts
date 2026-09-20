import { z } from 'zod';
import { ErrorCodeSchema, type ErrorCode } from './auth.js';
import {
  BookDeltaSchema,
  CandleSchema,
  ChannelSchema,
  IntervalSchema,
  MarketSummarySchema,
  NetworkReportSchema,
  SymbolSchema,
  TierSchema,
  TimestampSchema,
  TradeSchema,
  type Tier,
} from './market.js';

/**
 * Every WebSocket frame, both directions, discriminated on `type`.
 * See docs/01-protocol.md §5–§6 and docs/03-adaptive-delivery.md §2.
 */

/** Wire protocol version. The path carries it too: `/v1/ws`. */
export const PROTOCOL_VERSION = 'v1' as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/**
 * Maximum delivery cadence per tier, in milliseconds. These are *maximum*
 * frequencies, not generation rates — a quiet market sends less. Book deltas are
 * absent on purpose: they are never paced (docs/03-adaptive-delivery.md §2, §9).
 */
export const TIER_CADENCE_MS: Readonly<
  Record<Tier, { readonly candlesUpdateMs: number; readonly tradesBatchMs: number }>
> = Object.freeze({
  full: Object.freeze({ candlesUpdateMs: 100, tradesBatchMs: 200 }),
  degraded: Object.freeze({ candlesUpdateMs: 500, tradesBatchMs: 500 }),
  minimal: Object.freeze({ candlesUpdateMs: 2000, tradesBatchMs: 2000 }),
});

/** New connections start here — we know nothing about the link yet (§5 Initial tier). */
export const INITIAL_TIER: Tier = 'degraded';

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export const SubscribeFrameSchema = z.object({
  type: z.literal('subscribe'),
  symbol: SymbolSchema,
  channels: z.array(ChannelSchema).nonempty(),
  /** Required when `channels` includes `candles`; per symbol, not per connection. */
  interval: IntervalSchema.optional(),
});

export const UnsubscribeFrameSchema = z.object({
  type: z.literal('unsubscribe'),
  symbol: SymbolSchema,
});

export const SetIntervalFrameSchema = z.object({
  type: z.literal('set_interval'),
  symbol: SymbolSchema,
  interval: IntervalSchema,
});

export const PingFrameSchema = z.object({
  type: z.literal('ping'),
  id: z.string().min(1).max(64),
});

export const NetworkReportFrameSchema = NetworkReportSchema.extend({
  type: z.literal('network.report'),
});

export const TierOverrideFrameSchema = z.object({
  type: z.literal('debug.tier_override'),
  /** `null` returns the connection to automatic tiering. */
  tier: z.union([TierSchema, z.null()]),
});

export const ClientFrameSchema = z.discriminatedUnion('type', [
  SubscribeFrameSchema,
  UnsubscribeFrameSchema,
  SetIntervalFrameSchema,
  PingFrameSchema,
  NetworkReportFrameSchema,
  TierOverrideFrameSchema,
]);
export type ClientFrame = z.infer<typeof ClientFrameSchema>;
export type ClientFrameType = ClientFrame['type'];

export const CLIENT_FRAME_TYPES: readonly ClientFrameType[] = Object.freeze([
  'subscribe',
  'unsubscribe',
  'set_interval',
  'ping',
  'network.report',
  'debug.tier_override',
]);

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export const HelloFrameSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  connectionId: z.string().min(1),
  serverTime: TimestampSchema,
  tier: TierSchema,
  symbols: z.array(MarketSummarySchema),
});

/** Acknowledges a subscription change. After `unsubscribe`, `channels` is empty. */
export const SubscribedFrameSchema = z.object({
  type: z.literal('subscribed'),
  symbol: SymbolSchema,
  channels: z.array(ChannelSchema),
  interval: z.union([IntervalSchema, z.null()]),
});

export const PongFrameSchema = z.object({
  type: z.literal('pong'),
  id: z.string().min(1).max(64),
});

export const TradesBatchFrameSchema = z.object({
  type: z.literal('trades.batch'),
  symbol: SymbolSchema,
  trades: z.array(TradeSchema),
});

export const BookDeltaFrameSchema = BookDeltaSchema;

/** Zero or more finalised candles plus at most one active candle. */
export const CandlesUpdateFrameSchema = z.object({
  type: z.literal('candles.update'),
  symbol: SymbolSchema,
  interval: IntervalSchema,
  candles: z.array(CandleSchema),
});

export const TierChangeReasonSchema = z.enum(['hysteresis', 'override', 'missing_reports']);
export type TierChangeReason = z.infer<typeof TierChangeReasonSchema>;

/** Emitted whenever `effectiveTier` changes, so the UI never has to infer it. */
export const TierChangedFrameSchema = z.object({
  type: z.literal('tier.changed'),
  autoTier: TierSchema,
  override: z.union([TierSchema, z.null()]),
  effectiveTier: TierSchema,
  reason: TierChangeReasonSchema,
  candlesUpdateMs: z.number().int().positive(),
  tradesBatchMs: z.number().int().positive(),
});

export const ErrorFrameSchema = z.object({
  type: z.literal('error'),
  code: ErrorCodeSchema,
  message: z.string().optional(),
});

export const ServerFrameSchema = z.discriminatedUnion('type', [
  HelloFrameSchema,
  SubscribedFrameSchema,
  PongFrameSchema,
  TradesBatchFrameSchema,
  BookDeltaFrameSchema,
  CandlesUpdateFrameSchema,
  TierChangedFrameSchema,
  ErrorFrameSchema,
]);
export type ServerFrame = z.infer<typeof ServerFrameSchema>;
export type ServerFrameType = ServerFrame['type'];

export type SubscribeFrame = z.infer<typeof SubscribeFrameSchema>;
export type UnsubscribeFrame = z.infer<typeof UnsubscribeFrameSchema>;
export type SetIntervalFrame = z.infer<typeof SetIntervalFrameSchema>;
export type PingFrame = z.infer<typeof PingFrameSchema>;
export type NetworkReportFrame = z.infer<typeof NetworkReportFrameSchema>;
export type TierOverrideFrame = z.infer<typeof TierOverrideFrameSchema>;
export type HelloFrame = z.infer<typeof HelloFrameSchema>;
export type SubscribedFrame = z.infer<typeof SubscribedFrameSchema>;
export type PongFrame = z.infer<typeof PongFrameSchema>;
export type TradesBatchFrame = z.infer<typeof TradesBatchFrameSchema>;
export type BookDeltaFrame = z.infer<typeof BookDeltaFrameSchema>;
export type CandlesUpdateFrame = z.infer<typeof CandlesUpdateFrameSchema>;
export type TierChangedFrame = z.infer<typeof TierChangedFrameSchema>;
export type ErrorFrame = z.infer<typeof ErrorFrameSchema>;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export type DecodeResult<T> =
  | { readonly ok: true; readonly frame: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

const textEncoder = new TextEncoder();

function failure(code: ErrorCode, message: string): DecodeResult<never> {
  return { ok: false, code, message };
}

/**
 * Maps a validation failure onto the documented error code. The field that broke
 * decides the code, which is why the client learns `INVALID_INTERVAL` rather than
 * a generic parse error.
 *
 * `UNKNOWN_SYMBOL` is deliberately not produced here: a well-formed symbol that
 * the registry does not serve is a gateway decision, not a schema one
 * (docs/01-protocol.md §2).
 */
function codeForIssues(issues: readonly z.core.$ZodIssue[]): ErrorCode {
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'interval') return 'INVALID_INTERVAL';
    if (field === 'channels') return 'INVALID_CHANNEL';
  }
  return 'INVALID_MESSAGE';
}

/**
 * Parses one inbound client frame. Never throws: a malformed frame is a value,
 * and the caller replies `error` and keeps the socket (docs/01-protocol.md §5).
 */
export function decodeClientFrame(
  raw: string,
  options: { readonly maxBytes?: number } = {},
): DecodeResult<ClientFrame> {
  const { maxBytes } = options;
  if (maxBytes !== undefined && textEncoder.encode(raw).length > maxBytes) {
    return failure('INVALID_MESSAGE', `frame exceeds ${maxBytes} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure('INVALID_MESSAGE', 'not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failure('INVALID_MESSAGE', 'frame must be a JSON object');
  }

  const type: unknown = (parsed as Record<string, unknown>).type;
  if (typeof type !== 'string') {
    return failure('INVALID_MESSAGE', 'missing string `type`');
  }
  if (!CLIENT_FRAME_TYPES.includes(type as ClientFrameType)) {
    return failure('UNKNOWN_TYPE', `unknown frame type ${JSON.stringify(type)}`);
  }

  const result = ClientFrameSchema.safeParse(parsed);
  if (!result.success) {
    return failure(codeForIssues(result.error.issues), z.prettifyError(result.error));
  }

  const frame = result.data;
  // Cross-field rule: `interval` is required whenever `candles` is requested.
  if (frame.type === 'subscribe' && frame.channels.includes('candles') && !frame.interval) {
    return failure('INVALID_INTERVAL', '`interval` is required when subscribing to `candles`');
  }

  return { ok: true, frame };
}

/** Parses one inbound server frame. Used by the browser client (docs/04-frontend.md §4). */
export function decodeServerFrame(raw: string): DecodeResult<ServerFrame> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failure('INVALID_MESSAGE', 'not valid JSON');
  }

  const result = ServerFrameSchema.safeParse(parsed);
  if (!result.success) {
    return failure('INVALID_MESSAGE', z.prettifyError(result.error));
  }
  return { ok: true, frame: result.data };
}
