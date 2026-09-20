import { randomUUID } from 'node:crypto';
import websocketPlugin from '@fastify/websocket';
import type { ServerFrame } from '@repo/protocol';
import { CLOSE_CODES, PROTOCOL_VERSION } from '@repo/protocol';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app/context.js';
import type { MarketRuntime } from '../app/market-runtime.js';
import { METRIC } from '../observability/metrics.js';
import { ConnectionSession } from './connection-session.js';
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
  const dispatcher = new MarketDispatcher(context.metrics);
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
    const ticket = (request.query as { ticket?: unknown } | undefined)?.ticket;
    const rawTicket = typeof ticket === 'string' ? ticket : undefined;

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
      }),
      maxSubscriptions: context.websocket.maxSubscriptions,
      now: Date.now(),
    });

    const handle: ConnectionHandle = {
      session,
      isOpen: () => socket.readyState === socket.OPEN,
      send,
    };
    dispatcher.add(handle);
    dispatcherHandles.add(handle);
    context.metrics.increment(METRIC.wsConnections);
    refreshGauges();
    // Never log a ticket value — log its subject (docs/06-ops-deploy.md §5).
    request.log.info(
      { event: 'ws.connected', connectionId: session.connectionId, sub: subject },
      'connection accepted',
    );

    send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      connectionId: session.connectionId,
      serverTime: Date.now(),
      tier: session.effectiveTier,
      symbols: context.repository.markets(),
    });

    const heartbeat = setInterval(() => {
      if (Date.now() - session.lastInboundAt > heartbeatTimeoutMs) {
        close(CLOSE_CODES.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
      }
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
        now: Date.now,
        onSubscriptionsChanged: refreshGauges,
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
