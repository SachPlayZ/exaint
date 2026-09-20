import { z } from 'zod';
import { PRICE_SCALE, QUANTITY_SCALE } from './decimal.js';

/**
 * Market domain values as they appear on the wire.
 *
 * The Zod schema is the definition; every type here is inferred from one.
 * See docs/01-protocol.md §2–§3 and docs/02-market-domain.md §8.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Shape of a symbol identifier. Membership is decided by the server's registry
 * (`MARKET_SYMBOLS`) and reported by `GET /v1/markets` — never by this schema,
 * because the frontend is forbidden from hardcoding the list
 * (docs/01-protocol.md §2).
 */
export const SYMBOL_PATTERN = /^[A-Z0-9]{2,10}-[A-Z]{2,6}$/;

export const SymbolSchema = z.string().regex(SYMBOL_PATTERN);
export type MarketSymbol = z.infer<typeof SymbolSchema>;

export const IntervalSchema = z.enum(['1s', '5s', '1m']);
export type Interval = z.infer<typeof IntervalSchema>;

/** Milliseconds per interval — the bucket width in docs/02-market-domain.md §8. */
export const INTERVAL_MS: Readonly<Record<Interval, number>> = Object.freeze({
  '1s': 1_000,
  '5s': 5_000,
  '1m': 60_000,
});

export const TierSchema = z.enum(['full', 'degraded', 'minimal']);
export type Tier = z.infer<typeof TierSchema>;

export const ChannelSchema = z.enum(['book', 'trades', 'candles']);
export type Channel = z.infer<typeof ChannelSchema>;

export const SideSchema = z.enum(['buy', 'sell']);
export type Side = z.infer<typeof SideSchema>;

/** Milliseconds since the epoch. Display data — never an ordering key (I3). */
export const TimestampSchema = z.number().int().nonnegative();

const decimalString = (scale: number) =>
  z
    .string()
    .regex(
      new RegExp(String.raw`^-?(?:0|[1-9]\d*)(?:\.\d{1,${scale}})?$`),
      `expected a decimal string with at most ${scale} fraction digits`,
    );

const unsignedDecimalString = (scale: number) =>
  z
    .string()
    .regex(
      new RegExp(String.raw`^(?:0|[1-9]\d*)(?:\.\d{1,${scale}})?$`),
      `expected a non-negative decimal string with at most ${scale} fraction digits`,
    );

/** Price on the wire — decimal string, scale 4. */
export const PriceSchema = unsignedDecimalString(PRICE_SCALE);

/** Quantity on the wire — decimal string, scale 8. `"0"` deletes a book level. */
export const QuantitySchema = unsignedDecimalString(QUANTITY_SCALE);

/** Signed decimal, for values that may legitimately go below zero. */
export const SignedPriceSchema = decimalString(PRICE_SCALE);

/** `tradeId` / `sequence` — per symbol, decimal string, strictly increasing. */
export const IdentifierSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MarketSummarySchema = z.object({
  symbol: SymbolSchema,
  priceScale: z.literal(PRICE_SCALE),
  quantityScale: z.literal(QUANTITY_SCALE),
  tickSize: PriceSchema,
  bookDepth: z.number().int().positive(),
});
export type MarketSummary = z.infer<typeof MarketSummarySchema>;

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export const TradeSchema = z.object({
  type: z.literal('trade'),
  symbol: SymbolSchema,
  tradeId: IdentifierSchema,
  timestamp: TimestampSchema,
  side: SideSchema,
  price: PriceSchema,
  quantity: QuantitySchema,
});
export type Trade = z.infer<typeof TradeSchema>;

// ---------------------------------------------------------------------------
// Order book
// ---------------------------------------------------------------------------

/** `[price, quantity]`. Quantity `"0"` in a delta deletes the level. */
export const BookLevelSchema = z.tuple([PriceSchema, QuantitySchema]);
export type BookLevel = z.infer<typeof BookLevelSchema>;

export const BookSnapshotSchema = z.object({
  symbol: SymbolSchema,
  sequence: IdentifierSchema,
  bids: z.array(BookLevelSchema),
  asks: z.array(BookLevelSchema),
});
export type BookSnapshot = z.infer<typeof BookSnapshotSchema>;

export const BookDeltaSchema = z.object({
  type: z.literal('book.delta'),
  symbol: SymbolSchema,
  previousSequence: IdentifierSchema,
  sequence: IdentifierSchema,
  timestamp: TimestampSchema,
  bids: z.array(BookLevelSchema),
  asks: z.array(BookLevelSchema),
});
export type BookDelta = z.infer<typeof BookDeltaSchema>;

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

export const CandleSchema = z.object({
  symbol: SymbolSchema,
  startTime: TimestampSchema,
  open: PriceSchema,
  high: PriceSchema,
  low: PriceSchema,
  close: PriceSchema,
  volume: QuantitySchema,
  tradeCount: z.number().int().nonnegative(),
  /** Highest `tradeId` folded into this candle — the merge tiebreaker, not decoration. */
  lastTradeId: IdentifierSchema,
  /** `false` while the bucket is still open. */
  final: z.boolean(),
});
export type Candle = z.infer<typeof CandleSchema>;

// ---------------------------------------------------------------------------
// Network measurement
// ---------------------------------------------------------------------------

/** Client-measured round-trip latency. Never an estimate of one-way latency. */
export const NetworkReportSchema = z.object({
  rttMs: z.number().nonnegative().finite(),
  jitterMs: z.number().nonnegative().finite(),
  samples: z.number().int().positive(),
});
export type NetworkReport = z.infer<typeof NetworkReportSchema>;
