import type { Channel, Interval, Tier } from '@repo/protocol';
import { CLOSE_CODES, decodeServerFrame } from '@repo/protocol';
import {
  BACKOFF_MAX_MS,
  ERROR_AFTER_ATTEMPTS,
  STABLE_CONNECTION_MS,
  backoffDelayMs,
} from './backoff.js';
import { TypedEmitter } from './emitter.js';
import { LatencyTracker } from './latency-tracker.js';
import type {
  ConnectionState,
  DesiredSubscription,
  MarketSocketOptions,
  SocketEvents,
  TimerApi,
  WebSocketLike,
} from './types.js';

/** App-level probe cadence (docs/03-adaptive-delivery.md §3–§4). */
export const PING_INTERVAL_MS = 2_000;
export const NETWORK_REPORT_INTERVAL_MS = 5_000;

const OPEN = 1;

const defaultTimers: TimerApi = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms) as unknown as number,
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

/**
 * Socket lifecycle with no React in it: ticket acquisition, connect, reconnect,
 * ping/pong, frame validation, and the desired-subscription set that gets
 * reapplied after every reconnect (docs/04-frontend.md §2, §4, §11).
 *
 * The separation is the point — T5, T6 and T7 all depend on this being testable
 * without a browser.
 */
export class MarketSocketClient {
  readonly events = new TypedEmitter<SocketEvents>();
  readonly latency = new LatencyTracker();

  readonly #options: MarketSocketOptions;
  readonly #timers: TimerApi;
  readonly #now: () => number;
  readonly #random: () => number;

  #state: ConnectionState = 'STALE';
  #socket: WebSocketLike | null = null;
  #started = false;

  /** What the app wants to be subscribed to, independent of any one socket. */
  readonly #desired = new Map<string, DesiredSubscription>();
  /** Only reapplied when the user explicitly chose it (docs/04 §11 step 9). */
  #tierOverride: Tier | null = null;
  #hasExplicitOverride = false;

  #attempt = 0;
  #connectedAt: number | null = null;
  #lastLiveAt: number | null = null;
  #pendingPings = new Map<string, number>();
  #pingSequence = 0;

  #reconnectTimer: number | null = null;
  #pingTimer: number | null = null;
  #reportTimer: number | null = null;

  constructor(options: MarketSocketOptions) {
    this.#options = options;
    this.#timers = options.timers ?? defaultTimers;
    this.#now = options.now ?? (() => performance.now());
    this.#random = options.random ?? Math.random;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get tierOverride(): Tier | null {
    return this.#tierOverride;
  }

  /** Milliseconds since the last frame arrived — what the STALE badge counts. */
  ageMs(): number | null {
    return this.#lastLiveAt === null ? null : this.#now() - this.#lastLiveAt;
  }

  subscriptions(): DesiredSubscription[] {
    return [...this.#desired.values()];
  }

  connect(): void {
    if (this.#started) return;
    this.#started = true;
    this.#attempt = 0;
    this.#setState('CONNECTING');
    void this.#attemptConnect();
  }

  /** Closes everything this client created. Idempotent. */
  disconnect(): void {
    this.#started = false;
    this.#clearTimer('reconnect');
    this.#stopMeasurement();
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(1000, 'client disconnect');
    this.#setState('STALE');
  }

  subscribe(symbol: string, channels: readonly Channel[], interval: Interval | null): void {
    this.#desired.set(symbol, { symbol, channels: [...channels], interval });
    this.#send({
      type: 'subscribe',
      symbol,
      channels: [...channels] as [Channel, ...Channel[]],
      ...(interval === null ? {} : { interval }),
    });
  }

  unsubscribe(symbol: string): void {
    this.#desired.delete(symbol);
    this.#send({ type: 'unsubscribe', symbol });
  }

  setInterval(symbol: string, interval: Interval): void {
    const existing = this.#desired.get(symbol);
    if (existing === undefined) return;
    this.#desired.set(symbol, { ...existing, interval });
    this.#send({ type: 'set_interval', symbol, interval });
  }

  /** The client may only *request* an override. The server owns `autoTier`. */
  setTierOverride(tier: Tier | null): void {
    this.#tierOverride = tier;
    this.#hasExplicitOverride = true;
    this.#send({ type: 'debug.tier_override', tier });
  }

  /** Called by the book synchronisers once every subscribed symbol is in sync. */
  markSynchronized(): void {
    if (this.#state === 'SYNCING') this.#setState('LIVE');
  }

  /** Called when a symbol falls out of sync and is rebuilding. */
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

  #send(frame: Record<string, unknown>): void {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  async #attemptConnect(): Promise<void> {
    if (!this.#started) return;

    let ticket: string;
    try {
      // Inside the backoff, never before it: a backend that is down fails the
      // ticket fetch too, and that must not bypass the delay (docs/04 §4).
      ticket = (await this.#options.fetchTicket()).ticket;
    } catch (error) {
      this.#log('socket.ticket_failed', { error: String(error) });
      this.#scheduleReconnect();
      return;
    }
    if (!this.#started) return;

    const separator = this.#options.wsUrl.includes('?') ? '&' : '?';
    const socket = this.#options.createSocket(
      `${this.#options.wsUrl}${separator}ticket=${encodeURIComponent(ticket)}`,
    );
    this.#socket = socket;

    socket.onopen = () => this.#onOpen();
    socket.onmessage = (event) => this.#onMessage(event.data);
    socket.onclose = (event) => this.#onClose(event.code, event.reason);
    socket.onerror = () => this.#log('socket.error', {});
  }

  #onOpen(): void {
    this.#connectedAt = this.#now();
    this.latency.reset();
    this.#pendingPings.clear();
    this.#startMeasurement();
  }

  #onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    const decoded = decodeServerFrame(data);
    if (!decoded.ok) {
      this.#log('socket.invalid_frame', { code: decoded.code });
      return;
    }

    this.#lastLiveAt = this.#now();
    const frame = decoded.frame;

    switch (frame.type) {
      case 'hello':
        this.#attempt = 0;
        this.#setState('SYNCING');
        this.events.emit('hello', frame);
        // Everything is rebuilt on a new socket: a fresh snapshot per symbol,
        // fresh history, then the interval and any explicit override.
        this.events.emit('resync', { reason: 'reconnect' });
        this.#reapplyDesiredState();
        return;
      case 'pong': {
        const sentAt = this.#pendingPings.get(frame.id);
        if (sentAt === undefined) return;
        this.#pendingPings.delete(frame.id);
        this.latency.record(this.#now() - sentAt);
        this.events.emit('latency', {
          rttMs: this.latency.rttMs,
          jitterMs: this.latency.jitterMs,
        });
        return;
      }
      case 'error':
        this.events.emit('error', frame);
        return;
      default:
        this.events.emit(frame.type, frame as never);
    }
  }

  #reapplyDesiredState(): void {
    for (const subscription of this.#desired.values()) {
      this.#send({
        type: 'subscribe',
        symbol: subscription.symbol,
        channels: [...subscription.channels],
        ...(subscription.interval === null ? {} : { interval: subscription.interval }),
      });
    }
    // Only if the user explicitly selected one — a reconnect must not resurrect
    // an override they already cleared (docs/04 §11 step 9).
    if (this.#hasExplicitOverride) {
      this.#send({ type: 'debug.tier_override', tier: this.#tierOverride });
    }
  }

  #onClose(code: number, reason: string): void {
    this.#stopMeasurement();
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

  #startMeasurement(): void {
    this.#stopMeasurement();
    this.#pingTimer = this.#timers.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    this.#reportTimer = this.#timers.setInterval(
      () => this.sendNetworkReport(),
      NETWORK_REPORT_INTERVAL_MS,
    );
    this.sendPing();
  }

  /** Public so the visibility handler can probe immediately on wake (docs/04 §12). */
  sendPing(): void {
    this.#pingSequence += 1;
    const id = String(this.#pingSequence);
    this.#pendingPings.set(id, this.#now());
    // Unanswered pings would otherwise accumulate across a stalled link.
    if (this.#pendingPings.size > 16) {
      const oldest = this.#pendingPings.keys().next();
      if (!oldest.done) this.#pendingPings.delete(oldest.value);
    }
    this.#send({ type: 'ping', id });
  }

  sendNetworkReport(): void {
    const report = this.latency.takeReport();
    if (report === null) return;
    this.#send({ type: 'network.report', ...report });
  }

  #stopMeasurement(): void {
    this.#clearTimer('ping');
    this.#clearTimer('report');
  }

  #clearTimer(which: 'reconnect' | 'ping' | 'report'): void {
    if (which === 'reconnect' && this.#reconnectTimer !== null) {
      this.#timers.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (which === 'ping' && this.#pingTimer !== null) {
      this.#timers.clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
    if (which === 'report' && this.#reportTimer !== null) {
      this.#timers.clearInterval(this.#reportTimer);
      this.#reportTimer = null;
    }
  }
}
