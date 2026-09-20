import type { Channel, Interval, MarketSymbol, Tier } from '@repo/protocol';
import { INITIAL_TIER } from '@repo/protocol';
import type { ConnectionRateLimiter } from './rate-limiter.js';

/**
 * Per-socket state. **Tier state is never global** — the full field list is in
 * docs/03-adaptive-delivery.md §8.
 *
 * Tier lives on the session; delivery state lives on the subscription. That
 * split is what lets one connection hold five symbols without five tiers.
 * The scheduler fields below are populated in P6; P5 sends as data arrives.
 */
export interface SymbolSubscription {
  readonly symbol: MarketSymbol;
  channels: Set<Channel>;
  subscribedInterval: Interval | null;
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
      this.subscriptions.set(symbol, {
        symbol,
        channels: new Set(channels),
        subscribedInterval: interval,
      });
      return;
    }
    existing.channels = new Set(channels);
    // Re-subscribing without candles must not silently keep a stale interval.
    existing.subscribedInterval = channels.includes('candles') ? interval : null;
  }

  unsubscribe(symbol: string): boolean {
    return this.subscriptions.delete(symbol);
  }
}
