import type { Channel, Interval, Tier } from '@repo/protocol';
import { CLOSE_CODES, decodeServerFrame } from '@repo/protocol';
import {
  BACKOFF_MAX_MS,
  ERROR_AFTER_ATTEMPTS,
  STABLE_CONNECTION_MS,
  backoffDelayMs,
} from './backoff';
import { SocketDesiredState } from './desired-state';
import { TypedEmitter } from './emitter';
import { LatencyTracker } from './latency-tracker';
import {
  NETWORK_REPORT_INTERVAL_MS,
  PING_INTERVAL_MS,
  SocketMeasurement,
} from './socket-measurement';
import { defaultTimers } from './timer-api';
import type {
  ConnectionState,
  MarketSocketOptions,
  SocketEvents,
  TimerApi,
  WebSocketLike,
} from './types';
import { SocketVisibilityController, VISIBILITY_HARD_REFRESH_MS } from './visibility-controller';

export { NETWORK_REPORT_INTERVAL_MS, PING_INTERVAL_MS, VISIBILITY_HARD_REFRESH_MS };

const OPEN = 1;

/** React-free socket lifecycle (docs/04-frontend.md §2, §4, §11). */
export class MarketSocketClient {
  readonly events = new TypedEmitter<SocketEvents>();
  readonly latency = new LatencyTracker();

  readonly #options: MarketSocketOptions;
  readonly #timers: TimerApi;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #measurement: SocketMeasurement;
  readonly #visibility: SocketVisibilityController;
  readonly #desired: SocketDesiredState;

  #state: ConnectionState = 'STALE';
  #socket: WebSocketLike | null = null;
  #started = false;
  #hasSeenHello = false;

  #attempt = 0;
  #connectedAt: number | null = null;
  #lastLiveAt: number | null = null;

  #reconnectTimer: number | null = null;
  #ticketAbort: AbortController | null = null;

  constructor(options: MarketSocketOptions) {
    this.#options = options;
    this.#timers = options.timers ?? defaultTimers;
    this.#now = options.now ?? (() => performance.now());
    this.#random = options.random ?? Math.random;
    this.#measurement = new SocketMeasurement({
      latency: this.latency,
      timers: this.#timers,
      now: this.#now,
      send: (frame) => this.#send(frame),
    });
    this.#desired = new SocketDesiredState((frame) => this.#send(frame));
    this.#visibility = new SocketVisibilityController({
      ...(options.visibility === undefined ? {} : { source: options.visibility }),
      now: this.#now,
      onChange: ({ hidden, hiddenMs }) => {
        this.events.emit('visibility', { hidden, hiddenMs });
        if (hidden) return;
        this.sendPing();
        if (hiddenMs > VISIBILITY_HARD_REFRESH_MS) {
          this.events.emit('resync', { reason: 'visibility' });
        }
      },
    });
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get tierOverride(): Tier | null {
    return this.#desired.tierOverride;
  }

  ageMs(): number | null {
    return this.#lastLiveAt === null ? null : this.#now() - this.#lastLiveAt;
  }

  subscriptions() {
    return this.#desired.subscriptions();
  }

  connect(): void {
    if (this.#started) return;
    this.#started = true;
    this.#attempt = 0;
    this.#hasSeenHello = false;
    this.#visibility.start();
    this.#setState('CONNECTING');
    void this.#attemptConnect();
  }

  disconnect(): void {
    this.#started = false;
    this.#clearReconnectTimer();
    this.#measurement.stop();
    this.#ticketAbort?.abort();
    this.#ticketAbort = null;
    this.#visibility.stop();
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) this.#detachSocket(socket);
    socket?.close(1000, 'client disconnect');
    this.#setState('STALE');
  }

  subscribe(symbol: string, channels: readonly Channel[], interval: Interval | null): void {
    this.#desired.subscribe(symbol, channels, interval);
  }

  unsubscribe(symbol: string): void {
    this.#desired.unsubscribe(symbol);
  }

  setInterval(symbol: string, interval: Interval): void {
    this.#desired.setInterval(symbol, interval);
  }

  /** The client may only *request* an override. The server owns `autoTier`. */
  setTierOverride(tier: Tier | null): void {
    this.#desired.setTierOverride(tier);
  }

  markSynchronized(): void {
    if (this.#state === 'SYNCING') this.#setState('LIVE');
  }

  markSyncing(): void {
    if (this.#state === 'LIVE') this.#setState('SYNCING');
  }

  #setState(next: ConnectionState): void {
    if (next === this.#state) return;
    const previous = this.#state;
    this.#state = next;
    this.events.emit('state', { state: next, previous });
  }

  #log(event: string, detail: Record<string, unknown> = {}): void {
    this.#options.onLog?.(event, detail);
  }

  #send(frame: Record<string, unknown>): boolean {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  async #attemptConnect(): Promise<void> {
    if (!this.#started) return;

    this.#ticketAbort?.abort();
    const ticketAbort = new AbortController();
    this.#ticketAbort = ticketAbort;
    let ticket: string;
    try {
      // Inside the backoff, never before it: a backend that is down fails the
      // ticket fetch too, and that must not bypass the delay (docs/04 §4).
      ticket = (await this.#options.fetchTicket(ticketAbort.signal)).ticket;
    } catch (error) {
      if (this.#ticketAbort === ticketAbort) this.#ticketAbort = null;
      if (ticketAbort.signal.aborted || !this.#started) return;
      this.#log('socket.ticket_failed', { error: String(error) });
      this.#scheduleReconnect();
      return;
    }
    if (this.#ticketAbort === ticketAbort) this.#ticketAbort = null;
    if (!this.#started || ticketAbort.signal.aborted) return;

    const separator = this.#options.wsUrl.includes('?') ? '&' : '?';
    const socket = this.#options.createSocket(
      `${this.#options.wsUrl}${separator}ticket=${encodeURIComponent(ticket)}`,
    );
    this.#socket = socket;

    socket.onopen = () => this.#onOpen(socket);
    socket.onmessage = (event) => this.#onMessage(socket, event.data);
    socket.onclose = (event) => this.#onClose(socket, event.code, event.reason);
    socket.onerror = () => this.#log('socket.error', {});
  }

  #onOpen(socket: WebSocketLike): void {
    if (this.#socket !== socket) return;
    this.#connectedAt = this.#now();
    this.#measurement.start();
  }

  #onMessage(socket: WebSocketLike, data: unknown): void {
    if (this.#socket !== socket) return;
    if (typeof data !== 'string') return;
    const decoded = decodeServerFrame(data);
    if (!decoded.ok) {
      this.#log('socket.invalid_frame', { code: decoded.code });
      return;
    }

    this.#lastLiveAt = this.#now();
    const frame = decoded.frame;

    switch (frame.type) {
      case 'hello': {
        this.#attempt = 0;
        const reconnect = this.#hasSeenHello;
        this.#setState('SYNCING');
        // Everything is rebuilt on a new socket: a fresh snapshot per symbol,
        // fresh history, then the interval and any explicit override.
        this.#desired.reapply();
        this.events.emit('hello', frame);
        if (reconnect) this.events.emit('resync', { reason: 'reconnect' });
        this.#hasSeenHello = true;
        return;
      }
      case 'pong': {
        const sample = this.#measurement.receivePong(frame.id);
        if (sample !== null) this.events.emit('latency', sample);
        return;
      }
      case 'error':
        this.events.emit('error', frame);
        return;
      default:
        this.events.emit(frame.type, frame as never);
    }
  }

  #onClose(socket: WebSocketLike, code: number, reason: string): void {
    this.#detachSocket(socket);
    if (this.#socket !== socket) return;
    this.#measurement.stop();
    this.#socket = null;
    this.events.emit('closed', { code, reason });
    this.#log('socket.closed', { code, reason });

    if (code === CLOSE_CODES.BACKPRESSURE) {
      this.events.emit('resync', { reason: 'backpressure' });
    }
    if (!this.#started) return;

    // A connection that stayed healthy longer than the backoff ceiling has
    // demonstrably recovered, so the retry count starts again.
    const uptime = this.#connectedAt === null ? 0 : this.#now() - this.#connectedAt;
    if (uptime >= STABLE_CONNECTION_MS) this.#attempt = 0;
    this.#connectedAt = null;

    this.#setState(this.#attempt >= ERROR_AFTER_ATTEMPTS ? 'ERROR' : 'STALE');
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (!this.#started || this.#reconnectTimer !== null) return;
    const delay = backoffDelayMs(this.#attempt, this.#random);
    this.#attempt += 1;
    this.#log('socket.reconnect_scheduled', { attempt: this.#attempt, delayMs: delay });

    this.#reconnectTimer = this.#timers.setTimeout(
      () => {
        this.#reconnectTimer = null;
        if (!this.#started) return;
        this.#setState(this.#attempt >= ERROR_AFTER_ATTEMPTS ? 'ERROR' : 'RECONNECTING');
        void this.#attemptConnect();
      },
      Math.min(delay, BACKOFF_MAX_MS * 2),
    );
  }

  sendPing(): void {
    this.#measurement.sendPing();
  }

  sendNetworkReport(): void {
    this.#measurement.sendNetworkReport();
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #detachSocket(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }
}
