import { LatencyTracker } from './latency-tracker';
import type { TimerApi } from './types';

export const PING_INTERVAL_MS = 2_000;
export const NETWORK_REPORT_INTERVAL_MS = 5_000;

export class SocketMeasurement {
  readonly latency: LatencyTracker;
  readonly #timers: TimerApi;
  readonly #now: () => number;
  readonly #send: (frame: Record<string, unknown>) => boolean;
  readonly #pendingPings = new Map<string, number>();
  #pingSequence = 0;
  #pingTimer: number | null = null;
  #reportTimer: number | null = null;

  constructor(options: {
    readonly latency: LatencyTracker;
    readonly timers: TimerApi;
    readonly now: () => number;
    readonly send: (frame: Record<string, unknown>) => boolean;
  }) {
    this.latency = options.latency;
    this.#timers = options.timers;
    this.#now = options.now;
    this.#send = options.send;
  }

  start(): void {
    this.stop();
    this.latency.reset();
    this.#pingTimer = this.#timers.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    this.#reportTimer = this.#timers.setInterval(
      () => this.sendNetworkReport(),
      NETWORK_REPORT_INTERVAL_MS,
    );
    this.sendPing();
  }

  stop(): void {
    if (this.#pingTimer !== null) this.#timers.clearInterval(this.#pingTimer);
    if (this.#reportTimer !== null) this.#timers.clearInterval(this.#reportTimer);
    this.#pingTimer = null;
    this.#reportTimer = null;
    this.#pendingPings.clear();
  }

  sendPing(): void {
    const nextSequence = this.#pingSequence + 1;
    const id = String(nextSequence);
    if (!this.#send({ type: 'ping', id })) return;
    this.#pingSequence = nextSequence;
    this.#pendingPings.set(id, this.#now());
    if (this.#pendingPings.size > 16) {
      const oldest = this.#pendingPings.keys().next();
      if (!oldest.done) this.#pendingPings.delete(oldest.value);
    }
  }

  receivePong(id: string): { readonly rttMs: number; readonly jitterMs: number } | null {
    const sentAt = this.#pendingPings.get(id);
    if (sentAt === undefined) return null;
    this.#pendingPings.delete(id);
    this.latency.record(this.#now() - sentAt);
    return { rttMs: this.latency.rttMs, jitterMs: this.latency.jitterMs };
  }

  sendNetworkReport(): void {
    const report = this.latency.takeReport();
    if (report !== null) this.#send({ type: 'network.report', ...report });
  }
}
