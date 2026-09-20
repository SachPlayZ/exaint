import type { ClientFrame, ErrorCode, ServerFrame, Tier } from '@repo/protocol';
import { CLOSE_CODES, decodeClientFrame } from '@repo/protocol';
import type { MarketRepository } from '../market/market-repository.js';
import { METRIC, type MetricsRegistry } from '../observability/metrics.js';
import type { ConnectionSession } from './connection-session.js';

export interface FrameHandlerDeps {
  readonly session: ConnectionSession;
  readonly repository: MarketRepository;
  readonly metrics: MetricsRegistry;
  readonly maxFrameBytes: number;
  readonly enableDebugControls: boolean;
  readonly send: (frame: ServerFrame) => void;
  readonly close: (code: number, reason: string) => void;
  readonly now: () => number;
  /** Called whenever the subscription set changed, so gauges can be refreshed. */
  readonly onSubscriptionsChanged: () => void;
  readonly onNetworkReport: (rttMs: number, jitterMs: number) => void;
  readonly onTierOverride: (tier: Tier | null) => void;
}

/**
 * Routes one inbound frame.
 *
 * Nothing here throws. A malformed frame produces an `error` and the connection
 * survives; only sustained rate abuse closes a socket (docs/01-protocol.md §5, §8).
 */
export function handleClientFrame(raw: string, deps: FrameHandlerDeps): void {
  const { session, metrics, send } = deps;
  session.lastInboundAt = deps.now();

  const decoded = decodeClientFrame(raw, { maxBytes: deps.maxFrameBytes });
  if (!decoded.ok) {
    metrics.increment(METRIC.invalidWsMessages);
    send({ type: 'error', code: decoded.code, message: decoded.message });
    return;
  }

  const frame = decoded.frame;
  const verdict = session.rateLimiter.check(frame.type);
  if (verdict !== 'allow') {
    metrics.increment(METRIC.rateLimitedFrames, { frame_type: frame.type });
    send({ type: 'error', code: 'RATE_LIMITED' });
    if (verdict === 'close') {
      metrics.increment(METRIC.rateLimitCloses);
      // The error frame is always sent before the close, so the reason is
      // visible in both places (docs/01-protocol.md §5).
      deps.close(CLOSE_CODES.RATE_LIMITED, 'rate limit strikes exceeded');
    }
    return;
  }

  applyFrame(frame, deps);
}

function reject(deps: FrameHandlerDeps, code: ErrorCode, message?: string): void {
  deps.send(message === undefined ? { type: 'error', code } : { type: 'error', code, message });
}

function applyFrame(frame: ClientFrame, deps: FrameHandlerDeps): void {
  const { session, repository, send } = deps;

  switch (frame.type) {
    case 'ping':
      // Replied immediately, never queued behind data frames, or the client's
      // RTT measurement is meaningless (docs/03-adaptive-delivery.md §3).
      send({ type: 'pong', id: frame.id });
      return;

    case 'network.report':
      // The controller owns rtt/jitter and the hysteresis counters.
      deps.onNetworkReport(frame.rttMs, frame.jitterMs);
      return;

    case 'debug.tier_override':
      if (!deps.enableDebugControls) {
        reject(deps, 'INVALID_MESSAGE', 'debug controls are disabled');
        return;
      }
      // The override moves effectiveTier only; autoTier keeps being measured
      // (docs/03-adaptive-delivery.md §7).
      deps.onTierOverride(frame.tier);
      return;

    case 'subscribe': {
      if (!repository.has(frame.symbol)) {
        reject(deps, 'UNKNOWN_SYMBOL', frame.symbol);
        return;
      }
      if (session.subscription(frame.symbol) === undefined && session.atSubscriptionCap) {
        reject(deps, 'TOO_MANY_SUBSCRIPTIONS');
        return;
      }
      const interval = frame.channels.includes('candles') ? (frame.interval ?? null) : null;
      session.subscribe(frame.symbol, frame.channels, interval);
      deps.onSubscriptionsChanged();
      send({
        type: 'subscribed',
        symbol: frame.symbol,
        channels: [...frame.channels],
        interval,
      });
      return;
    }

    case 'unsubscribe': {
      if (!session.unsubscribe(frame.symbol)) {
        reject(deps, 'NOT_SUBSCRIBED', frame.symbol);
        return;
      }
      deps.onSubscriptionsChanged();
      send({ type: 'subscribed', symbol: frame.symbol, channels: [], interval: null });
      return;
    }

    case 'set_interval': {
      const subscription = session.subscription(frame.symbol);
      if (subscription === undefined) {
        reject(deps, 'NOT_SUBSCRIBED', frame.symbol);
        return;
      }
      if (!subscription.channels.has('candles')) {
        reject(deps, 'NOT_SUBSCRIBED', `${frame.symbol} has no candles channel`);
        return;
      }
      // Per symbol: two symbols on one connection may sit on different intervals.
      subscription.subscribedInterval = frame.interval;
      send({
        type: 'subscribed',
        symbol: frame.symbol,
        channels: [...subscription.channels],
        interval: frame.interval,
      });
      return;
    }
  }
}
