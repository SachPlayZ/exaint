import type {
  BookDeltaFrame,
  CandlesUpdateFrame,
  Channel,
  ErrorFrame,
  HelloFrame,
  Interval,
  SubscribedFrame,
  Tier,
  TradesBatchFrame,
  TierChangedFrame,
} from '@repo/protocol';

/**
 * Connection states (docs/04-frontend.md §3). Not `isConnected: boolean`: every
 * piece of UI logic gets dramatically cleaner once these are real states, and
 * `SYNCING` is what lets the book be visible-but-honest during a resync.
 *
 * `AUTHENTICATING` is deliberately absent — the ticket fetch is the first step
 * of `CONNECTING`, and surfacing it would only add a flicker nobody can act on.
 */
export type ConnectionState =
  'CONNECTING' | 'SYNCING' | 'LIVE' | 'STALE' | 'RECONNECTING' | 'ERROR';

export interface DesiredSubscription {
  readonly symbol: string;
  readonly channels: readonly Channel[];
  readonly interval: Interval | null;
}

export interface SocketEvents {
  state: { readonly state: ConnectionState; readonly previous: ConnectionState };
  hello: HelloFrame;
  subscribed: SubscribedFrame;
  'book.delta': BookDeltaFrame;
  'trades.batch': TradesBatchFrame;
  'candles.update': CandlesUpdateFrame;
  'tier.changed': TierChangedFrame;
  error: ErrorFrame;
  /** Latency measured on this connection, after every pong. */
  latency: { readonly rttMs: number; readonly jitterMs: number };
  /** The socket went away; `code` is the close status the server sent. */
  closed: { readonly code: number; readonly reason: string };
  /**
   * Everything subscribed must be rebuilt from a fresh snapshot: a new
   * connection, a backpressure close, or a long hidden tab.
   */
  resync: { readonly reason: 'reconnect' | 'backpressure' | 'visibility' };
}

/** The slice of `WebSocket` this client uses, so tests can supply a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface TimerApi {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

export interface MarketSocketOptions {
  readonly wsUrl: string;
  readonly fetchTicket: () => Promise<{ ticket: string }>;
  readonly createSocket: (url: string) => WebSocketLike;
  /** Monotonic, for durations. `performance.now`, never `Date.now`. */
  readonly now?: () => number;
  readonly timers?: TimerApi;
  readonly random?: () => number;
  readonly onLog?: (event: string, detail: Record<string, unknown>) => void;
}

export type { Tier };
