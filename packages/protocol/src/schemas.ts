/**
 * Every Zod schema in the protocol, in one place.
 *
 * The schemas are defined next to the types they describe so each module stays
 * small; this barrel is what lets a test — or a route handler — reach the whole
 * contract through a single import. The schema is always the definition, and the
 * type is always `z.infer` of it (docs/01-protocol.md §1).
 */

export {
  BookDeltaSchema,
  BookLevelSchema,
  BookSnapshotSchema,
  CandleSchema,
  ChannelSchema,
  IdentifierSchema,
  IntervalSchema,
  MarketSummarySchema,
  NetworkReportSchema,
  PriceSchema,
  QuantitySchema,
  SideSchema,
  SignedPriceSchema,
  SymbolSchema,
  TierSchema,
  TimestampSchema,
  TradeSchema,
} from './market.js';

export { ErrorCodeSchema, TicketPayloadSchema, TicketSchema } from './auth.js';

export {
  BookSnapshotResponseSchema,
  CandleHistoryQuerySchema,
  CandleHistoryResponseSchema,
  HealthResponseSchema,
  MarketsResponseSchema,
  ReadyResponseSchema,
  RestErrorCodeSchema,
  RestErrorResponseSchema,
  SymbolParamsSchema,
  TicketResponseSchema,
} from './rest.js';

export {
  BookDeltaFrameSchema,
  CandlesUpdateFrameSchema,
  ClientFrameSchema,
  ErrorFrameSchema,
  HelloFrameSchema,
  NetworkReportFrameSchema,
  PingFrameSchema,
  PongFrameSchema,
  ServerFrameSchema,
  SetIntervalFrameSchema,
  SubscribeFrameSchema,
  SubscribedFrameSchema,
  TierChangeReasonSchema,
  TierChangedFrameSchema,
  TierOverrideFrameSchema,
  TradesBatchFrameSchema,
  UnsubscribeFrameSchema,
} from './websocket.js';
