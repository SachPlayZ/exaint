import type { Channel, Interval, MarketSymbol, Tier } from '@repo/protocol';
import { INITIAL_TIER } from '@repo/protocol';
import type { DomainCandle } from '../market/candles/candle.js';
import type { DomainTrade } from '../market/events.js';
import type { ConnectionRateLimiter } from './rate-limiter.js';

/**
 * Per-socket state. **Tier state is never global** — the full field list is in
 * docs/03-adaptive-delivery.md §8.
 *
 * Tier lives on the session; delivery state lives on the subscription. That
 * split is what lets one connection hold five symbols without five tiers.
 */
export class SymbolSubscription {
  readonly symbol: MarketSymbol;
  channels: Set<Channel>;
  subscribedInterval: Interval | null;

  lastCandleSentAt = 0;
  /** Accumulates: every closed candle is delivered exactly once (I2). */
  pendingFinalCandles: DomainCandle[] = [];
  /** Coalesces: only the newest version of the open bucket matters. */
  latestActiveCandle: DomainCandle | null = null;

  lastTradeBatchSentAt = 0;
  pendingTrades: DomainTrade[] = [];

  constructor(symbol: MarketSymbol, channels: readonly Channel[], interval: Interval | null) {
    this.symbol = symbol;
    this.channels = new Set(channels);
    this.subscribedInterval = interval;
  }

  /**
   * Switching interval discards candle state for the old one. Merging a `1s`
   * bucket into a `1m` stream would be a silently wrong chart.
   */
  setInterval(interval: Interval | null): void {
    if (interval === this.subscribedInterval) return;
    this.subscribedInterval = interval;
    this.pendingFinalCandles = [];
    this.latestActiveCandle = null;
  }
}

export class ConnectionSession {
  readonly connectionId: string;
  /** `sub` from the auth ticket — the rate-limit identity, not a user. */
  readonly subject: string;
  readonly connectedAt: number;
  readonly rateLimiter: ConnectionRateLimiter;
  readonly maxSubscriptions: number;

  /** Server-owned. The client may request an override, never an automatic tier. */
  autoTier: Tier = INITIAL_TIER;
  tierOverride: Tier | null = null;

  rttMs = 0;
  jitterMs = 0;
  consecutiveGoodReports = 0;
  consecutiveBadReports = 0;
  lastNetworkReportAt: number | null = null;
  lastInboundAt: number;

  readonly subscriptions = new Map<MarketSymbol, SymbolSubscription>();

  constructor(options: {
    readonly connectionId: string;
    readonly subject: string;
    readonly rateLimiter: ConnectionRateLimiter;
    readonly maxSubscriptions: number;
    readonly now: number;
  }) {
    this.connectionId = options.connectionId;
    this.subject = options.subject;
    this.rateLimiter = options.rateLimiter;
    this.maxSubscriptions = options.maxSubscriptions;
    this.connectedAt = options.now;
    this.lastInboundAt = options.now;
  }

  /** What actually governs delivery: the override when set, otherwise the measured tier. */
  get effectiveTier(): Tier {
    return this.tierOverride ?? this.autoTier;
  }

  get atSubscriptionCap(): boolean {
    return this.subscriptions.size >= this.maxSubscriptions;
  }

  subscription(symbol: string): SymbolSubscription | undefined {
    return this.subscriptions.get(symbol);
  }

  subscribe(symbol: MarketSymbol, channels: readonly Channel[], interval: Interval | null): void {
    const existing = this.subscriptions.get(symbol);
    if (existing === undefined) {
      this.subscriptions.set(symbol, new SymbolSubscription(symbol, channels, interval));
      return;
    }
    existing.channels = new Set(channels);
    // Re-subscribing without candles must not silently keep a stale interval.
    existing.setInterval(channels.includes('candles') ? interval : null);
  }

  unsubscribe(symbol: string): boolean {
    return this.subscriptions.delete(symbol);
  }
}
