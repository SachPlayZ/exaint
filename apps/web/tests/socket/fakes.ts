import type { ServerFrame } from '@repo/protocol';
import type { TimerApi, WebSocketLike } from '../../features/market/socket/types.js';

/** A socket the test drives by hand. No network, no browser. */
export class FakeSocket implements WebSocketLike {
  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closedWith: { code?: number; reason?: string } | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
    this.readyState = 3;
  }

  /** Test-side helpers. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(frame: ServerFrame | string): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** Parsed frames the client sent, in order. */
  frames<T = Record<string, unknown>>(): T[] {
    return this.sent.map((raw) => JSON.parse(raw) as T);
  }

  framesOfType(type: string): Record<string, unknown>[] {
    return this.frames<Record<string, unknown>>().filter((frame) => frame.type === type);
  }
}

interface ScheduledTimer {
  readonly handler: () => void;
  readonly intervalMs: number | null;
  dueAt: number;
}

/** Deterministic timers and clock. A test that sleeps is a test that flakes. */
export class FakeTimers implements TimerApi {
  #now: number;
  #nextHandle = 1;
  readonly #timers = new Map<number, ScheduledTimer>();

  constructor(startAt = 0) {
    this.#now = startAt;
  }

  now = (): number => this.#now;

  get pending(): number {
    return this.#timers.size;
  }

  setTimeout(handler: () => void, ms: number): number {
    const handle = this.#nextHandle++;
    this.#timers.set(handle, { handler, intervalMs: null, dueAt: this.#now + ms });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.#timers.delete(handle);
  }

  setInterval(handler: () => void, ms: number): number {
    const handle = this.#nextHandle++;
    this.#timers.set(handle, { handler, intervalMs: ms, dueAt: this.#now + ms });
    return handle;
  }

  clearInterval(handle: number): void {
    this.#timers.delete(handle);
  }

  /** Runs every timer due within `ms`, in order, advancing the clock as it goes. */
  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      let nextHandle: number | null = null;
      let nextDue = Number.POSITIVE_INFINITY;
      for (const [handle, timer] of this.#timers) {
        if (timer.dueAt <= target && timer.dueAt < nextDue) {
          nextDue = timer.dueAt;
          nextHandle = handle;
        }
      }
      if (nextHandle === null) break;

      const timer = this.#timers.get(nextHandle);
      if (timer === undefined) break;
      this.#now = timer.dueAt;
      if (timer.intervalMs === null) this.#timers.delete(nextHandle);
      else timer.dueAt = this.#now + timer.intervalMs;
      timer.handler();
    }
    this.#now = target;
  }
}

/** Lets pending promise callbacks run — the ticket fetch is async. */
export async function flush(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}
