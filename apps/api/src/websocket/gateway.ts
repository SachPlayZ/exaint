import { randomUUID } from 'node:crypto';
import websocketPlugin from '@fastify/websocket';
import type { ServerFrame } from '@repo/protocol';
import { CLOSE_CODES, PROTOCOL_VERSION, TIER_CADENCE_MS } from '@repo/protocol';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app/context.js';
import type { MarketRuntime } from '../app/market-runtime.js';
import { METRIC } from '../observability/metrics.js';
import { ConnectionSession } from './connection-session.js';
import { TierController } from './tier-controller.js';
import { MarketDispatcher, type ConnectionHandle } from './dispatcher.js';
import { handleClientFrame } from './frame-handler.js';
import { ConnectionRateLimiter } from './rate-limiter.js';

/** Inbound silence that closes a socket, per the `4000` close code in docs/01-protocol.md §5. */
export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const HEARTBEAT_CHECK_MS = 5_000;

export interface GatewayOptions {
  /** Overridable so the close path can be tested without waiting 45 s. */
  readonly heartbeatTimeoutMs?: number;
  readonly heartbeatCheckMs?: number;
  /**
   * The clock every time-based per-connection decision reads: delivery cadence,
   * token-bucket refill, the heartbeat, and the missing-report ladder. One
   * clock, so tests can advance them together.
   */
  readonly now?: () => number;
}

/**
 * The WebSocket gateway. One versioned endpoint, gated by a connect ticket.
 *
 * The ticket authorises the **connect**, not the session: nothing here tears a
 * live socket down at `exp` (docs/adr/0007-ws-auth-ticket.md).
 */
export async function registerWebSocketGateway(
  server: FastifyInstance,
  context: AppContext,
  runtime: MarketRuntime,
  options: GatewayOptions = {},
): Promise<MarketDispatcher> {
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const heartbeatCheckMs = options.heartbeatCheckMs ?? HEARTBEAT_CHECK_MS;
  const now = options.now ?? Date.now;
  const dispatcher = new MarketDispatcher(context.metrics, now);
  await server.register(websocketPlugin, {
    options: { maxPayload: context.websocket.maxFrameBytes },
  });

  const unsubscribeRuntime = runtime.subscribe((result) => dispatcher.dispatch(result));
  server.addHook('onClose', async () => unsubscribeRuntime());

  const dispatcherHandles = new Set<ConnectionHandle>();

  function refreshGauges(): void {
    const bySymbol = new Map<string, number>();
    const byTier = new Map<string, number>();
    for (const handle of dispatcherHandles) {
      byTier.set(handle.session.effectiveTier, (byTier.get(handle.session.effectiveTier) ?? 0) + 1);
      for (const symbol of handle.session.subscriptions.keys()) {
        bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + 1);
      }
    }
    for (const symbol of context.repository.markets().map((market) => market.symbol)) {
      context.metrics.setGauge(METRIC.subscriptionsBySymbol, { symbol }, bySymbol.get(symbol) ?? 0);
    }
    for (const tier of ['full', 'degraded', 'minimal'] as const) {
      context.metrics.setGauge(METRIC.connectionsByTier, { tier }, byTier.get(tier) ?? 0);
    }
  }

  server.get('/v1/ws', { websocket: true }, (socket, request) => {
    const query = request.query as { ticket?: unknown; reconnect?: unknown } | undefined;
    const rawTicket = typeof query?.ticket === 'string' ? query.ticket : undefined;
    const isReconnect = query?.reconnect === 'true' || query?.reconnect === true;

    const send = (frame: ServerFrame): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };
    const close = (code: number, reason: string): void => socket.close(code, reason);

    let subject = 'anon-local';
    if (context.tickets !== null) {
      const verification = context.tickets.verifyAndConsume(rawTicket);
      if (!verification.ok) {
        context.metrics.increment(METRIC.authFailures, { reason: verification.reason });
        request.log.warn(
          { event: 'ws.auth_rejected', reason: verification.reason },
          'connection rejected',
        );
        send({ type: 'error', code: verification.reason });
        close(
          verification.reason === 'UNAUTHORIZED'
            ? CLOSE_CODES.UNAUTHORIZED
            : CLOSE_CODES.TICKET_EXPIRED,
          verification.reason,
        );
        return;
      }
      subject = verification.payload.sub;
    }

    const session = new ConnectionSession({
      connectionId: randomUUID(),
      subject,
      rateLimiter: new ConnectionRateLimiter({
        globalPerSecond: context.websocket.globalFramesPerSecond,
        strikeLimit: context.websocket.strikeLimit,
        now,
      }),
      maxSubscriptions: context.websocket.maxSubscriptions,
      now: now(),
    });

    const tiers = new TierController(session);
    const handle: ConnectionHandle = {
      session,
      isOpen: () => socket.readyState === socket.OPEN,
      send,
      bufferedAmount: () => socket.bufferedAmount,
      close,
      onResyncClose: (reason) => {
        request.log.warn(
          { event: 'ws.close_resync', connectionId: session.connectionId, reason },
          'resync-causing close',
        );
      },
    };

    /** Emitted whenever `effectiveTier` moves, so the UI never has to infer it. */
    const announceTier = (update: {
      changed: boolean;
      autoTier: typeof session.autoTier;
      effectiveTier: typeof session.autoTier;
      reason: 'hysteresis' | 'override' | 'missing_reports';
    }): void => {
      if (!update.changed) return;
      const cadence = TIER_CADENCE_MS[update.effectiveTier];
      send({
        type: 'tier.changed',
        autoTier: update.autoTier,
        override: session.tierOverride,
        effectiveTier: update.effectiveTier,
        reason: update.reason,
        candlesUpdateMs: cadence.candlesUpdateMs,
        tradesBatchMs: cadence.tradesBatchMs,
      });
      context.metrics.increment(METRIC.tierChanges, { reason: update.reason });
      refreshGauges();
      request.log.info(
        {
          event: 'tier.changed',
          connectionId: session.connectionId,
          to: update.effectiveTier,
          autoTier: update.autoTier,
          reason: update.reason,
          rttMs: session.rttMs,
          jitterMs: session.jitterMs,
        },
        'tier changed',
      );
    };
    dispatcher.add(handle);
    dispatcherHandles.add(handle);
    context.metrics.increment(METRIC.wsConnections);
    if (isReconnect) {
      context.metrics.increment(METRIC.wsReconnects);
    }
    refreshGauges();
    // Never log a ticket value — log its subject (docs/06-ops-deploy.md §5).
    request.log.info(
      { event: 'ws.connected', connectionId: session.connectionId, sub: subject },
      'connection accepted',
    );
    if (isReconnect) {
      request.log.info(
        { event: 'ws.reconnected', connectionId: session.connectionId, sub: subject },
        'connection reconnected',
      );
    }

    send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      connectionId: session.connectionId,
      serverTime: now(),
      tier: session.effectiveTier,
      symbols: context.repository.markets(),
    });

    // One timer per connection covers both clocks: the heartbeat close and the
    // missing-report ladder (docs/03-adaptive-delivery.md §6).
    const heartbeat = setInterval(() => {
      const at = now();
      if (at - session.lastInboundAt > heartbeatTimeoutMs) {
        close(CLOSE_CODES.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
        return;
      }
      announceTier(tiers.applySilence(at));
    }, heartbeatCheckMs);
    heartbeat.unref?.();

    socket.on('message', (payload: Buffer) => {
      handleClientFrame(payload.toString('utf8'), {
        session,
        repository: context.repository,
        metrics: context.metrics,
        maxFrameBytes: context.websocket.maxFrameBytes,
        enableDebugControls: context.http.enableDebugControls,
        send,
        close,
        now,
        onSubscriptionsChanged: refreshGauges,
        onNetworkReport: (rttMs, jitterMs) =>
          announceTier(tiers.applyReport(rttMs, jitterMs, now())),
        onTierOverride: (tier) => announceTier(tiers.setOverride(tier)),
        onRateLimitStrike: (frameType, strikes, isClose) => {
          request.log.warn(
            {
              event: 'rate_limit.strike',
              connectionId: session.connectionId,
              frameType,
              strikes,
            },
            'rate limit strike',
          );
          if (isClose) {
            request.log.warn(
              {
                event: 'ws.close_resync',
                connectionId: session.connectionId,
                reason: 'rate_limited',
              },
              'rate limit close',
            );
          }
        },
      });
    });

    // Every timer and listener created above is cancelled here, in the same
    // place (AGENTS.md §4 teardown table).
    socket.on('close', () => {
      clearInterval(heartbeat);
      dispatcher.remove(handle);
      dispatcherHandles.delete(handle);
      refreshGauges();
      request.log.info(
        { event: 'ws.closed', connectionId: session.connectionId },
        'connection closed',
      );
    });

    socket.on('error', (error: Error) => {
      request.log.warn(
        { event: 'ws.error', connectionId: session.connectionId, err: error },
        'socket error',
      );
    });
  });

  return dispatcher;
}
