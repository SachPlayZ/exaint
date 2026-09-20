import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE_CODES, PROTOCOL_VERSION } from '@repo/protocol';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import { TestSocket } from '../helpers/ws-client.js';

const apps: TestApp[] = [];
const sockets: TestSocket[] = [];

async function bootstrap(
  options: Parameters<typeof createTestApp>[0] = {},
): Promise<{ app: TestApp; url: string }> {
  const app = await createTestApp(options);
  apps.push(app);
  return { app, url: await app.listen() };
}

async function mintTicket(app: TestApp): Promise<string> {
  const response = await app.server.inject({ method: 'POST', url: '/v1/auth/ticket' });
  return (response.json() as { ticket: string }).ticket;
}

async function connect(url: string, ticket: string | null): Promise<TestSocket> {
  const socket = await TestSocket.connect(
    ticket === null ? url : `${url}?ticket=${encodeURIComponent(ticket)}`,
  );
  sockets.push(socket);
  return socket;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const app of apps.splice(0)) await app.close();
});

describe('handshake (T7, ticket half over the socket)', () => {
  it('accepts a valid ticket and says hello with the registry', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));

    const hello = await socket.waitFor('hello');
    expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(hello.connectionId).toMatch(/^[0-9a-f-]{36}$/);
    // New connections start DEGRADED — we know nothing about this link yet.
    expect(hello.tier).toBe('degraded');
    expect(hello.symbols.map((market) => market.symbol)).toEqual([...app.registry.symbols]);
    expect(socket.isOpen).toBe(true);
  });

  it('rejects a missing ticket with UNAUTHORIZED and close 4401', async () => {
    const { url } = await bootstrap();
    const socket = await connect(url, null);
    expect((await socket.waitFor('error')).code).toBe('UNAUTHORIZED');
    expect((await socket.waitForClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('rejects a bad signature with UNAUTHORIZED and close 4401', async () => {
    const { app, url } = await bootstrap();
    const ticket = await mintTicket(app);
    const socket = await connect(url, `${ticket.split('.')[0]}.forged`);
    expect((await socket.waitFor('error')).code).toBe('UNAUTHORIZED');
    expect((await socket.waitForClose()).code).toBe(CLOSE_CODES.UNAUTHORIZED);
  });

  it('rejects an expired ticket with TICKET_EXPIRED and close 4408', async () => {
    const clock = { value: Date.now() };
    const { app, url } = await bootstrap({ ticketNow: () => clock.value });
    const ticket = await mintTicket(app);

    clock.value += 60_001;
    const socket = await connect(url, ticket);
    expect((await socket.waitFor('error')).code).toBe('TICKET_EXPIRED');
    expect((await socket.waitForClose()).code).toBe(CLOSE_CODES.TICKET_EXPIRED);
  });

  it('rejects a replayed ticket with TICKET_EXPIRED and close 4408', async () => {
    const { app, url } = await bootstrap();
    const ticket = await mintTicket(app);

    const first = await connect(url, ticket);
    await first.waitFor('hello');

    const replay = await connect(url, ticket);
    expect((await replay.waitFor('error')).code).toBe('TICKET_EXPIRED');
    expect((await replay.waitForClose()).code).toBe(CLOSE_CODES.TICKET_EXPIRED);
    expect(first.isOpen).toBe(true);
  });

  it('keeps a live connection past its ticket exp — the ticket authorises the connect', async () => {
    const clock = { value: Date.now() };
    const { app, url } = await bootstrap({ ticketNow: () => clock.value });
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    // Well past exp. Nothing may tear the socket down for that reason.
    clock.value += 10 * 60_000;
    socket.send({ type: 'ping', id: 'after-exp' });
    expect((await socket.waitFor('pong')).id).toBe('after-exp');
    expect(socket.isOpen).toBe(true);
    expect(socket.closed).toBeNull();
  });
});

describe('subscription semantics', () => {
  it('acknowledges a subscription and then streams that symbol', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    socket.send({
      type: 'subscribe',
      symbol: 'BTC-USD',
      channels: ['book', 'trades', 'candles'],
      interval: '1s',
    });
    const ack = await socket.waitFor('subscribed');
    expect(ack).toMatchObject({ symbol: 'BTC-USD', interval: '1s' });
    expect([...ack.channels].sort()).toEqual(['book', 'candles', 'trades']);

    app.pump(60);
    const delta = await socket.waitFor('book.delta');
    expect(delta.symbol).toBe('BTC-USD');
    expect(BigInt(delta.sequence) - BigInt(delta.previousSequence)).toBe(1n);
    expect((await socket.waitFor('trades.batch')).symbol).toBe('BTC-USD');
    expect((await socket.waitFor('candles.update')).interval).toBe('1s');
  });

  it('sends only the channels that were asked for', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    socket.send({ type: 'subscribe', symbol: 'ETH-USD', channels: ['book'] });
    await socket.waitFor('subscribed');
    app.pump(40);
    await socket.waitFor('book.delta');
    await socket.settle();

    expect(socket.received('trades.batch')).toHaveLength(0);
    expect(socket.received('candles.update')).toHaveLength(0);
  });

  it('holds two connections on different symbols and different intervals at once', async () => {
    const { app, url } = await bootstrap();
    const one = await connect(url, await mintTicket(app));
    const two = await connect(url, await mintTicket(app));
    await one.waitFor('hello');
    await two.waitFor('hello');

    one.send({ type: 'subscribe', symbol: 'BTC-USD', channels: ['candles'], interval: '1s' });
    two.send({ type: 'subscribe', symbol: 'HYPE-USD', channels: ['candles'], interval: '5s' });
    await one.waitFor('subscribed');
    await two.waitFor('subscribed');

    app.pump(200);
    await one.waitFor('candles.update');
    await two.waitFor('candles.update');
    await one.settle();

    expect(new Set(one.received('candles.update').map((f) => f.symbol))).toEqual(
      new Set(['BTC-USD']),
    );
    expect(new Set(one.received('candles.update').map((f) => f.interval))).toEqual(new Set(['1s']));
    expect(new Set(two.received('candles.update').map((f) => f.symbol))).toEqual(
      new Set(['HYPE-USD']),
    );
    expect(new Set(two.received('candles.update').map((f) => f.interval))).toEqual(new Set(['5s']));
  });

  it('changes interval per symbol, leaving the other symbol alone', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    socket.send({ type: 'subscribe', symbol: 'BTC-USD', channels: ['candles'], interval: '1s' });
    socket.send({ type: 'subscribe', symbol: 'SOL-USD', channels: ['candles'], interval: '1s' });
    await socket.waitFor('subscribed', 2);

    socket.send({ type: 'set_interval', symbol: 'SOL-USD', interval: '1m' });
    const ack = await socket.waitFor('subscribed', 3);
    expect(ack).toMatchObject({ symbol: 'SOL-USD', interval: '1m' });

    app.pump(200);
    await socket.until(() => socket.received('candles.update').length > 4);
    const intervals = new Map<string, Set<string>>();
    for (const frame of socket.received('candles.update')) {
      intervals.set(frame.symbol, (intervals.get(frame.symbol) ?? new Set()).add(frame.interval));
    }
    expect(intervals.get('BTC-USD')).toEqual(new Set(['1s']));
    expect(intervals.get('SOL-USD')).toEqual(new Set(['1m']));
  });

  it('stops streaming after unsubscribe', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    socket.send({ type: 'subscribe', symbol: 'ZEC-USD', channels: ['book'] });
    await socket.waitFor('subscribed');
    app.pump(20);
    await socket.waitFor('book.delta');

    socket.send({ type: 'unsubscribe', symbol: 'ZEC-USD' });
    const ack = await socket.waitFor('subscribed', 2);
    expect(ack.channels).toEqual([]);

    const before = socket.received('book.delta').length;
    app.pump(60);
    await socket.settle();
    expect(socket.received('book.delta')).toHaveLength(before);
  });

  it('names the reason when a subscription request cannot be honoured', async () => {
    const { app, url } = await bootstrap({ maxSubscriptions: 2 });
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    socket.send({ type: 'subscribe', symbol: 'DOGE-USD', channels: ['book'] });
    expect((await socket.waitFor('error')).code).toBe('UNKNOWN_SYMBOL');

    socket.send({ type: 'set_interval', symbol: 'BTC-USD', interval: '1s' });
    expect((await socket.waitFor('error', 2)).code).toBe('NOT_SUBSCRIBED');

    socket.send({ type: 'unsubscribe', symbol: 'BTC-USD' });
    expect((await socket.waitFor('error', 3)).code).toBe('NOT_SUBSCRIBED');

    socket.send({ type: 'subscribe', symbol: 'BTC-USD', channels: ['book'] });
    socket.send({ type: 'subscribe', symbol: 'ETH-USD', channels: ['book'] });
    socket.send({ type: 'subscribe', symbol: 'SOL-USD', channels: ['book'] });
    expect((await socket.waitFor('error', 4)).code).toBe('TOO_MANY_SUBSCRIPTIONS');
    expect(socket.isOpen).toBe(true);
  });
});

describe('validation and resilience', () => {
  it('replies with the documented code and keeps the socket', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    const cases: [string, string][] = [
      ['not json at all', 'INVALID_MESSAGE'],
      [JSON.stringify({ type: 'nope' }), 'UNKNOWN_TYPE'],
      [
        JSON.stringify({ type: 'set_interval', symbol: 'BTC-USD', interval: '2s' }),
        'INVALID_INTERVAL',
      ],
      [
        JSON.stringify({ type: 'subscribe', symbol: 'BTC-USD', channels: ['ticker'] }),
        'INVALID_CHANNEL',
      ],
      [
        JSON.stringify({ type: 'subscribe', symbol: 'BTC-USD', channels: ['candles'] }),
        'INVALID_INTERVAL',
      ],
    ];
    for (const [payload] of cases) socket.send(payload);

    await socket.until(() => socket.received('error').length >= cases.length);
    expect(socket.received('error').map((frame) => frame.code)).toEqual(
      cases.map(([, code]) => code),
    );
    expect(socket.isOpen).toBe(true);

    socket.send({ type: 'ping', id: 'still-here' });
    expect((await socket.waitFor('pong')).id).toBe('still-here');
  });

  it('survives fuzzed garbage without killing the handler or the process', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    const garbage = [
      '',
      '{',
      '}{',
      '[]',
      'null',
      '"ping"',
      '\u0000\u0001\u0002',
      JSON.stringify({ type: 'ping', id: null }),
      JSON.stringify({ type: 'subscribe', symbol: 123, channels: 'book' }),
      JSON.stringify({ type: '__proto__' }),
      JSON.stringify({ type: 'ping', id: 'x'.repeat(5_000) }),
    ];
    for (const payload of garbage) socket.send(payload);
    await socket.settle(150);

    expect(socket.isOpen).toBe(true);
    socket.send({ type: 'ping', id: 'alive' });
    expect((await socket.waitFor('pong')).id).toBe('alive');
  });

  it('answers a ping immediately, echoing the id', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');
    socket.send({ type: 'ping', id: '1192' });
    expect((await socket.waitFor('pong')).id).toBe('1192');
  });

  it('closes with 4429 after three rate-limit strikes, error frame first', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    for (let index = 0; index < 12; index += 1) socket.send({ type: 'ping', id: `p${index}` });

    const close = await socket.waitForClose();
    expect(close.code).toBe(CLOSE_CODES.RATE_LIMITED);
    const errors = socket.received('error');
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(new Set(errors.map((frame) => frame.code))).toEqual(new Set(['RATE_LIMITED']));
    // The first four pings were inside the burst and were answered.
    expect(socket.received('pong')).toHaveLength(4);
  });

  it('gates debug.tier_override behind ENABLE_DEBUG_CONTROLS', async () => {
    const off = await bootstrap({ enableDebugControls: false });
    const blocked = await connect(off.url, await mintTicket(off.app));
    await blocked.waitFor('hello');
    blocked.send({ type: 'debug.tier_override', tier: 'minimal' });
    expect((await blocked.waitFor('error')).code).toBe('INVALID_MESSAGE');

    const on = await bootstrap({ enableDebugControls: true });
    const allowed = await connect(on.url, await mintTicket(on.app));
    await allowed.waitFor('hello');
    allowed.send({ type: 'debug.tier_override', tier: 'minimal' });
    await allowed.settle();
    expect(allowed.received('error')).toHaveLength(0);
    expect(allowed.isOpen).toBe(true);
  });
});

describe('adaptive delivery over the socket', () => {
  it('announces tier.changed on an override, with the target cadences', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    socket.send({ type: 'debug.tier_override', tier: 'minimal' });
    const changed = await socket.waitFor('tier.changed');
    expect(changed).toMatchObject({
      autoTier: 'degraded',
      override: 'minimal',
      effectiveTier: 'minimal',
      reason: 'override',
      candlesUpdateMs: 2_000,
      tradesBatchMs: 2_000,
    });

    socket.send({ type: 'debug.tier_override', tier: null });
    const cleared = await socket.waitFor('tier.changed', 2);
    expect(cleared).toMatchObject({
      override: null,
      effectiveTier: 'degraded',
      candlesUpdateMs: 500,
      tradesBatchMs: 500,
    });
  });

  it('promotes after five good reports and says so', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');

    // A real client reports every 5 s; the bucket is 1/s with a burst of 3.
    // Advance the connection clock rather than sleeping.
    for (let report = 0; report < 5; report += 1) {
      socket.send({ type: 'network.report', rttMs: 30, jitterMs: 4, samples: 3 });
      await socket.settle(20);
      app.advanceClock(5_000);
    }
    const changed = await socket.waitFor('tier.changed');
    expect(changed).toMatchObject({
      autoTier: 'full',
      effectiveTier: 'full',
      reason: 'hysteresis',
      candlesUpdateMs: 100,
      tradesBatchMs: 200,
    });
  });

  it('holds three tiers at once with identical candle values (docs/03 §8)', async () => {
    const { app, url } = await bootstrap();
    const tiers = ['full', 'degraded', 'minimal'] as const;
    const clients: { tier: (typeof tiers)[number]; socket: TestSocket }[] = [];
    for (const tier of tiers) {
      const socket = await connect(url, await mintTicket(app));
      await socket.waitFor('hello');
      socket.send({ type: 'debug.tier_override', tier });
      // No tier.changed for the degraded client: overriding to the tier it is
      // already on does not move effectiveTier, and the frame says so by absence.
      await socket.settle(20);
      expect(socket.received('tier.changed').length, tier).toBe(tier === 'degraded' ? 0 : 1);
      socket.send({ type: 'subscribe', symbol: 'BTC-USD', channels: ['candles'], interval: '1s' });
      await socket.waitFor('subscribed');
      clients.push({ tier, socket });
    }

    app.pump(400);
    await clients[2]?.socket.until(
      () => (clients[2]?.socket.received('candles.update').length ?? 0) >= 3,
    );
    await clients[0]?.socket.settle(100);

    const finalsFor = (socket: TestSocket): string[] =>
      socket
        .received('candles.update')
        .flatMap((frame) => frame.candles)
        .filter((candle) => candle.final)
        .map((candle) => JSON.stringify(candle));

    const [full, degraded, minimal] = clients.map((client) => finalsFor(client.socket));
    expect(minimal?.length ?? 0).toBeGreaterThan(2);
    // Cadence differs, values do not.
    expect(full?.slice(0, minimal?.length)).toEqual(minimal);
    expect(degraded?.slice(0, minimal?.length)).toEqual(minimal);
    expect(clients[0]?.socket.received('candles.update').length ?? 0).toBeGreaterThan(
      clients[2]?.socket.received('candles.update').length ?? 0,
    );
  });
});

describe('heartbeat', () => {
  it('closes a silent socket with 4000 and leaves a talking one alone', async () => {
    const { app, url } = await bootstrap({ heartbeatCheckMs: 20 });

    const chatty = await connect(url, await mintTicket(app));
    await chatty.waitFor('hello');
    const silent = await connect(url, await mintTicket(app));
    await silent.waitFor('hello');

    // 46 s of connection time, in four steps, with one socket still talking.
    for (let step = 0; step < 4; step += 1) {
      chatty.send({ type: 'ping', id: `keep-${step}` });
      await chatty.settle(30);
      app.advanceClock(11_500);
    }
    await silent.settle(60);

    expect((await silent.waitForClose()).code).toBe(CLOSE_CODES.HEARTBEAT_TIMEOUT);
    expect(chatty.isOpen).toBe(true);
  });
});

describe('teardown', () => {
  it('drops the connection from the dispatcher when the socket closes', async () => {
    const { app, url } = await bootstrap();
    const socket = await connect(url, await mintTicket(app));
    await socket.waitFor('hello');
    socket.send({ type: 'subscribe', symbol: 'BTC-USD', channels: ['book'] });
    await socket.waitFor('subscribed');

    const metrics = await app.server.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toMatch(/subscriptions_by_symbol\{symbol="BTC-USD"\} 1/);

    socket.close();
    await socket.until(() => socket.closed !== null);
    await socket.settle(100);

    const after = await app.server.inject({ method: 'GET', url: '/metrics' });
    expect(after.body).toMatch(/subscriptions_by_symbol\{symbol="BTC-USD"\} 0/);
    // Dispatching to a closed connection must not throw.
    expect(() => app.pump(20)).not.toThrow();
  });
});
