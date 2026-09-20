import { describe, expect, it } from 'vitest';
import type { HelloFrame, MarketSummary } from '@repo/protocol';
import { CLOSE_CODES } from '@repo/protocol';
import {
  BACKOFF_STEPS_MS,
  ERROR_AFTER_ATTEMPTS,
  STABLE_CONNECTION_MS,
} from '../../features/market/socket/backoff.js';
import {
  MarketSocketClient,
  NETWORK_REPORT_INTERVAL_MS,
  PING_INTERVAL_MS,
  VISIBILITY_HARD_REFRESH_MS,
} from '../../features/market/socket/market-socket-client.js';
import type { ConnectionState, VisibilitySource } from '../../features/market/socket/types.js';
import { FakeSocket, FakeTimers, FakeVisibility, flush } from './fakes.js';

const MARKET: MarketSummary = {
  symbol: 'BTC-USD',
  priceScale: 4,
  quantityScale: 8,
  tickSize: '0.1000',
  bookDepth: 25,
};

const hello = (connectionId = 'conn-1'): HelloFrame => ({
  type: 'hello',
  protocolVersion: 'v1',
  connectionId,
  serverTime: 1_700_000_000_000,
  tier: 'degraded',
  symbols: [MARKET],
});

interface Harness {
  readonly client: MarketSocketClient;
  readonly timers: FakeTimers;
  readonly sockets: FakeSocket[];
  readonly tickets: string[];
  readonly ticketSignals: AbortSignal[];
  readonly states: ConnectionState[];
  failTicket: boolean;
  /** The socket the client is currently using. */
  current(): FakeSocket;
}

function harness(options: { random?: () => number; visibility?: VisibilitySource } = {}): Harness {
  const timers = new FakeTimers(1_000);
  const sockets: FakeSocket[] = [];
  const tickets: string[] = [];
  const ticketSignals: AbortSignal[] = [];
  const states: ConnectionState[] = [];
  let counter = 0;

  const self: Harness = {
    failTicket: false,
    timers,
    sockets,
    tickets,
    ticketSignals,
    states,
    current(): FakeSocket {
      const socket = sockets[sockets.length - 1];
      if (socket === undefined) throw new Error('no socket has been created');
      return socket;
    },
    client: new MarketSocketClient({
      wsUrl: 'ws://api.test/v1/ws',
      fetchTicket: async (signal) => {
        ticketSignals.push(signal);
        if (self.failTicket) throw new Error('backend down');
        counter += 1;
        const ticket = `ticket-${counter}`;
        tickets.push(ticket);
        return { ticket };
      },
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      timers,
      now: timers.now,
      random: options.random ?? (() => 0.5),
      ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
    }),
  };
  self.client.events.on('state', ({ state }) => states.push(state));
  return self;
}

/** Connects and reaches LIVE, the way the app does. */
async function bringUp(h: Harness): Promise<FakeSocket> {
  h.client.connect();
  await flush();
  const socket = h.current();
  socket.open();
  socket.deliver(hello());
  h.client.markSynchronized();
  return socket;
}

describe('connect flow (docs/04-frontend.md §4)', () => {
  it('fetches a ticket, puts it in the URL, and reaches LIVE via SYNCING', async () => {
    const h = harness();
    h.client.connect();
    expect(h.client.state).toBe('CONNECTING');
    await flush();

    expect(h.tickets).toEqual(['ticket-1']);
    expect(h.current().url).toBe('ws://api.test/v1/ws?ticket=ticket-1');

    h.current().open();
    h.current().deliver(hello());
    expect(h.client.state).toBe('SYNCING');

    h.client.markSynchronized();
    expect(h.client.state).toBe('LIVE');
    expect(h.states).toEqual(['CONNECTING', 'SYNCING', 'LIVE']);
  });

  it('fetches a fresh ticket for every attempt and never reuses one', async () => {
    const h = harness();
    await bringUp(h);
    h.current().serverClose(1006);
    h.timers.advance(2_000);
    await flush();

    expect(h.tickets).toEqual(['ticket-1', 'ticket-2']);
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1]?.url).toContain('ticket-2');
  });

  it('keeps the ticket out of any storage — it only ever reaches the URL', async () => {
    const h = harness();
    await bringUp(h);
    // The client exposes no ticket accessor at all, by design.
    expect(Object.keys(h.client)).not.toContain('ticket');
    expect(JSON.stringify(h.client.subscriptions())).not.toContain('ticket-1');
  });

  it('treats a failed ticket fetch as a failed attempt, inside the backoff', async () => {
    const h = harness();
    h.failTicket = true;
    h.client.connect();
    await flush();

    // No socket was created, and nothing retried immediately.
    expect(h.sockets).toHaveLength(0);
    h.timers.advance(BACKOFF_STEPS_MS[0] ?? 250);
    await flush();
    expect(h.sockets).toHaveLength(0);

    h.failTicket = false;
    h.timers.advance(10_000);
    await flush();
    expect(h.sockets).toHaveLength(1);
  });
});

describe('reconnect (docs/04-frontend.md §11)', () => {
  it('follows the documented order and reapplies subscription and interval', async () => {
    const h = harness();
    await bringUp(h);
    h.client.subscribe('BTC-USD', ['book', 'trades', 'candles'], '1s');
    h.client.setInterval('BTC-USD', '1m');

    const resyncs: string[] = [];
    h.client.events.on('resync', ({ reason }) => resyncs.push(reason));

    h.current().serverClose(1006);
    expect(h.client.state).toBe('STALE');
    h.timers.advance(2_000);
    await flush();
    expect(h.client.state).toBe('RECONNECTING');

    const second = h.current();
    second.open();
    second.deliver(hello('conn-2'));

    // A fresh socket means a fresh snapshot and fresh history for every symbol.
    expect(resyncs).toEqual(['reconnect']);
    const resubscribe = second.framesOfType('subscribe');
    expect(resubscribe).toHaveLength(1);
    expect(resubscribe[0]).toMatchObject({ symbol: 'BTC-USD', interval: '1m' });
    expect(second.framesOfType('ping').length).toBeGreaterThan(0);
  });

  it('reapplies an override only when the user explicitly chose one', async () => {
    const quiet = harness();
    await bringUp(quiet);
    quiet.current().serverClose(1006);
    quiet.timers.advance(2_000);
    await flush();
    quiet.current().open();
    quiet.current().deliver(hello('conn-2'));
    expect(quiet.current().framesOfType('debug.tier_override')).toHaveLength(0);

    const chosen = harness();
    await bringUp(chosen);
    chosen.client.setTierOverride('minimal');
    chosen.current().serverClose(1006);
    chosen.timers.advance(2_000);
    await flush();
    chosen.current().open();
    chosen.current().deliver(hello('conn-2'));
    expect(chosen.current().framesOfType('debug.tier_override')).toEqual([
      { type: 'debug.tier_override', tier: 'minimal' },
    ]);
  });

  it('does not resurrect an override the user already cleared', async () => {
    const h = harness();
    await bringUp(h);
    h.client.setTierOverride('full');
    h.client.setTierOverride(null);

    h.current().serverClose(1006);
    h.timers.advance(2_000);
    await flush();
    h.current().open();
    h.current().deliver(hello('conn-2'));

    expect(h.current().framesOfType('debug.tier_override')).toEqual([
      { type: 'debug.tier_override', tier: null },
    ]);
  });

  it('backs off exponentially with jitter and never retries immediately', async () => {
    const h = harness({ random: () => 0.5 });
    h.failTicket = true;
    h.client.connect();
    await flush();

    const delays: number[] = [];
    let previous = h.timers.now();
    for (let attempt = 0; attempt < BACKOFF_STEPS_MS.length + 2; attempt += 1) {
      // Step forward until the next attempt fires.
      for (let step = 0; step < 40; step += 1) {
        const before = h.tickets.length;
        h.timers.advance(500);
        await flush();
        if (h.tickets.length > before) break;
      }
      delays.push(h.timers.now() - previous);
      previous = h.timers.now();
    }
    // Monotonic up to the ceiling, and the first is not zero.
    expect(delays[0]).toBeGreaterThan(0);
    expect(delays[delays.length - 1]).toBeGreaterThanOrEqual(delays[0] ?? 0);
  });

  it('resets the retry count after a connection that stayed healthy', async () => {
    const h = harness();
    await bringUp(h);
    h.current().serverClose(1006);
    h.timers.advance(2_000);
    await flush();

    const second = h.current();
    second.open();
    second.deliver(hello('conn-2'));
    h.timers.advance(STABLE_CONNECTION_MS + 1_000);
    second.serverClose(1006);

    // Back to the first, shortest step rather than continuing to climb.
    h.timers.advance(400);
    await flush();
    expect(h.sockets).toHaveLength(3);
  });

  it('surfaces ERROR once the ceiling has been hit repeatedly, and keeps trying', async () => {
    const h = harness();
    h.failTicket = true;
    h.client.connect();
    await flush();

    for (let attempt = 0; attempt < ERROR_AFTER_ATTEMPTS + 2; attempt += 1) {
      h.timers.advance(15_000);
      await flush();
    }
    expect(h.client.state).toBe('ERROR');

    h.failTicket = false;
    h.timers.advance(15_000);
    await flush();
    expect(h.sockets).toHaveLength(1);
  });
});

describe('close codes (docs/01-protocol.md §5)', () => {
  it('fetches a new ticket after 4401 and after 4408', async () => {
    for (const code of [CLOSE_CODES.UNAUTHORIZED, CLOSE_CODES.TICKET_EXPIRED]) {
      const h = harness();
      await bringUp(h);
      const before = h.tickets.length;

      h.current().serverClose(code);
      h.timers.advance(2_000);
      await flush();

      expect(h.tickets.length, String(code)).toBe(before + 1);
      expect(h.current().url, String(code)).toContain(h.tickets[before] ?? '');
    }
  });

  it('honours the backoff after 4429 rather than reconnecting immediately', async () => {
    const h = harness();
    await bringUp(h);
    h.current().serverClose(CLOSE_CODES.RATE_LIMITED);

    await flush();
    expect(h.sockets).toHaveLength(1);
    h.timers.advance(50);
    await flush();
    expect(h.sockets).toHaveLength(1);

    h.timers.advance(2_000);
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it('asks for a fresh snapshot after a backpressure close', async () => {
    const h = harness();
    await bringUp(h);
    const reasons: string[] = [];
    h.client.events.on('resync', ({ reason }) => reasons.push(reason));

    h.current().serverClose(CLOSE_CODES.BACKPRESSURE);
    expect(reasons).toEqual(['backpressure']);
  });

  it('reconnects normally after a heartbeat close', async () => {
    const h = harness();
    await bringUp(h);
    h.current().serverClose(CLOSE_CODES.HEARTBEAT_TIMEOUT);
    h.timers.advance(2_000);
    await flush();
    expect(h.sockets).toHaveLength(2);
  });
});

describe('latency measurement (docs/03-adaptive-delivery.md §3–§4)', () => {
  it('pings every 2 s and reports every 5 s', async () => {
    const h = harness();
    const socket = await bringUp(h);
    expect(socket.framesOfType('ping')).toHaveLength(1);

    h.timers.advance(PING_INTERVAL_MS * 3);
    expect(socket.framesOfType('ping')).toHaveLength(4);

    // Answer them so there is something to report.
    for (const frame of socket.framesOfType('ping')) {
      socket.deliver({ type: 'pong', id: String(frame.id) });
    }
    h.timers.advance(NETWORK_REPORT_INTERVAL_MS);
    const reports = socket.framesOfType('network.report');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ samples: 4 });
  });

  it('measures RTT as a duration and smooths it', async () => {
    const h = harness();
    const socket = await bringUp(h);
    const samples: number[] = [];
    h.client.events.on('latency', ({ rttMs }) => samples.push(rttMs));

    const ping = socket.framesOfType('ping')[0];
    h.timers.advance(40);
    socket.deliver({ type: 'pong', id: String(ping?.id) });

    expect(samples).toEqual([40]);
    expect(h.client.latency.rttMs).toBe(40);
  });

  it('sends no report when nothing new was measured', async () => {
    const h = harness();
    const socket = await bringUp(h);
    h.timers.advance(NETWORK_REPORT_INTERVAL_MS * 2);
    expect(socket.framesOfType('network.report')).toHaveLength(0);
  });

  it('ignores a pong for a ping it never sent', async () => {
    const h = harness();
    const socket = await bringUp(h);
    socket.deliver({ type: 'pong', id: 'not-mine' });
    expect(h.client.latency.hasSample).toBe(false);
  });
});

describe('browser visibility (docs/04-frontend.md §12)', () => {
  it('keeps the socket alive and resumes normally after less than 30 seconds', async () => {
    const visibility = new FakeVisibility();
    const h = harness({ visibility });
    const socket = await bringUp(h);
    const events: { readonly hidden: boolean; readonly hiddenMs: number }[] = [];
    const resyncs: string[] = [];
    h.client.events.on('visibility', (event) => events.push(event));
    h.client.events.on('resync', ({ reason }) => resyncs.push(reason));
    const pingsBefore = socket.framesOfType('ping').length;

    visibility.setHidden(true);
    h.timers.advance(VISIBILITY_HARD_REFRESH_MS - 1);
    visibility.setHidden(false);

    expect(events).toEqual([
      { hidden: true, hiddenMs: 0 },
      { hidden: false, hiddenMs: VISIBILITY_HARD_REFRESH_MS - 1 },
    ]);
    expect(resyncs).toEqual([]);
    expect(socket.framesOfType('ping')).toHaveLength(pingsBefore + 15);
    expect(h.sockets).toHaveLength(1);
  });

  it('requests a selected-symbol hard refresh after more than 30 seconds', async () => {
    const visibility = new FakeVisibility();
    const h = harness({ visibility });
    await bringUp(h);
    const reasons: string[] = [];
    h.client.events.on('resync', ({ reason }) => reasons.push(reason));

    visibility.setHidden(true);
    h.timers.advance(VISIBILITY_HARD_REFRESH_MS + 1);
    visibility.setHidden(false);

    expect(reasons).toEqual(['visibility']);
    expect(h.sockets).toHaveLength(1);
  });
});

describe('frame handling', () => {
  it('validates every inbound frame and ignores what does not parse', async () => {
    const h = harness();
    const socket = await bringUp(h);
    const seen: string[] = [];
    h.client.events.on('book.delta', (frame) => seen.push(frame.symbol));

    socket.deliver('not json');
    socket.deliver('{"type":"book.delta","symbol":"BTC-USD"}');
    socket.deliver({
      type: 'book.delta',
      symbol: 'BTC-USD',
      previousSequence: '1',
      sequence: '2',
      timestamp: 1,
      bids: [],
      asks: [['67232.0000', '0']],
    });

    expect(seen).toEqual(['BTC-USD']);
    expect(h.client.state).toBe('LIVE');
  });

  it('tracks how stale the data on screen is', async () => {
    const h = harness();
    const socket = await bringUp(h);
    h.timers.advance(4_200);
    socket.serverClose(1006);
    h.timers.advance(1_000);
    expect(h.client.ageMs()).toBeGreaterThanOrEqual(5_200);
  });
});

describe('teardown (docs/04-frontend.md §14)', () => {
  it('leaves no timer and no socket behind on disconnect', async () => {
    const h = harness();
    const socket = await bringUp(h);
    expect(h.timers.pending).toBeGreaterThan(0);

    h.client.disconnect();
    expect(h.timers.pending).toBe(0);
    expect(socket.closedWith).toMatchObject({ code: 1000 });
    expect(h.client.state).toBe('STALE');
    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(socket.onerror).toBeNull();

    // A late close from the socket must not start a reconnect after disconnect.
    socket.serverClose(1006);
    h.timers.advance(30_000);
    await flush();
    expect(h.sockets).toHaveLength(1);
  });

  it('unsubscribes a listener without disturbing its neighbours', async () => {
    const h = harness();
    const socket = await bringUp(h);
    const first: string[] = [];
    const second: string[] = [];
    const off = h.client.events.on('error', (frame) => first.push(frame.code));
    h.client.events.on('error', (frame) => second.push(frame.code));

    off();
    socket.deliver({ type: 'error', code: 'RATE_LIMITED' });
    expect(first).toEqual([]);
    expect(second).toEqual(['RATE_LIMITED']);
  });

  it('owns one visibility listener across reconnects and removes it on disconnect', async () => {
    const visibility = new FakeVisibility();
    const h = harness({ visibility });
    await bringUp(h);
    expect(visibility.listenerCount).toBe(1);

    h.current().serverClose(1006);
    h.timers.advance(2_000);
    await flush();
    h.current().open();
    h.current().deliver(hello('conn-2'));
    expect(visibility.listenerCount).toBe(1);

    h.client.disconnect();
    expect(visibility.listenerCount).toBe(0);
  });

  it('aborts an in-flight ticket request on disconnect', () => {
    const visibility = new FakeVisibility();
    let signal: AbortSignal | undefined;
    const client = new MarketSocketClient({
      wsUrl: 'ws://api.test/v1/ws',
      fetchTicket: (requestSignal) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
      createSocket: (url) => new FakeSocket(url),
      visibility,
    });

    client.connect();
    expect(signal?.aborted).toBe(false);
    client.disconnect();
    expect(signal?.aborted).toBe(true);
    expect(visibility.listenerCount).toBe(0);
  });
});
