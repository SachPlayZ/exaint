import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BookSnapshotResponseSchema,
  CANDLE_HISTORY_LIMIT_MAX,
  CandleHistoryResponseSchema,
  HealthResponseSchema,
  MarketsResponseSchema,
  ReadyResponseSchema,
  RestErrorResponseSchema,
  TicketResponseSchema,
} from '@repo/protocol';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /healthz and /readyz', () => {
  it('is live immediately but not ready until every engine has ticked', async () => {
    const fresh = await createTestApp();
    const notReady = await fresh.server.inject({ method: 'GET', url: '/readyz' });
    expect(notReady.statusCode).toBe(503);
    const pending = ReadyResponseSchema.parse(notReady.json());
    expect(pending.ready).toBe(false);
    expect(pending.pendingSymbols).toEqual([...fresh.registry.symbols]);

    const health = await fresh.server.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(health.json())).toEqual({ status: 'ok' });

    fresh.pump(1);
    const ready = await fresh.server.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ReadyResponseSchema.parse(ready.json())).toEqual({ ready: true, pendingSymbols: [] });
    await fresh.close();
  });
});

describe('GET /v1/markets', () => {
  it('serves the registry, schema-valid, with uniform scales', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/v1/markets' });
    expect(response.statusCode).toBe(200);
    const body = MarketsResponseSchema.parse(response.json());
    expect(body.symbols.map((s) => s.symbol)).toEqual([...app.registry.symbols]);
    expect(new Set(body.symbols.map((s) => s.priceScale))).toEqual(new Set([4]));
    expect(new Set(body.symbols.map((s) => s.tickSize)).size).toBeGreaterThan(1);
  });
});

describe('GET /v1/markets/:symbol/book', () => {
  beforeAll(() => {
    app.pump(600);
  });

  it('serves a schema-valid snapshot with that symbol s own sequence', async () => {
    const sequences = new Set<string>();
    for (const symbol of app.registry.symbols) {
      const response = await app.server.inject({
        method: 'GET',
        url: `/v1/markets/${symbol}/book`,
      });
      expect(response.statusCode, symbol).toBe(200);
      const body = BookSnapshotResponseSchema.parse(response.json());
      expect(body.symbol).toBe(symbol);
      expect(body.bids).toHaveLength(25);
      expect(body.asks).toHaveLength(25);
      sequences.add(body.sequence);
    }
    expect(sequences.size).toBeGreaterThan(0);
  });

  it('descends bids, ascends asks, and never crosses', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/v1/markets/BTC-USD/book' });
    const body = BookSnapshotResponseSchema.parse(response.json());
    const prices = (levels: [string, string][]): number[] => levels.map(([p]) => Number(p));
    const bids = prices(body.bids);
    const asks = prices(body.asks);
    expect(bids).toEqual([...bids].sort((a, b) => b - a));
    expect(asks).toEqual([...asks].sort((a, b) => a - b));
    expect(Math.max(...bids)).toBeLessThan(Math.min(...asks));
  });

  it('rejects a symbol the registry does not serve', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/v1/markets/DOGE-USD/book' });
    expect(response.statusCode).toBe(404);
    expect(RestErrorResponseSchema.parse(response.json()).code).toBe('UNKNOWN_SYMBOL');
  });
});

describe('GET /v1/markets/:symbol/candles', () => {
  it('returns completed history plus the active candle, marked final false', async () => {
    const response = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=1s&limit=50',
    });
    expect(response.statusCode).toBe(200);
    const body = CandleHistoryResponseSchema.parse(response.json());
    expect(body.symbol).toBe('BTC-USD');
    expect(body.interval).toBe('1s');
    expect(body.candles.length).toBeGreaterThan(1);

    const last = body.candles[body.candles.length - 1];
    expect(last?.final).toBe(false);
    for (const candle of body.candles.slice(0, -1)) expect(candle.final).toBe(true);
  });

  it('is ascending by startTime with no duplicates, ever', async () => {
    for (const interval of ['1s', '5s', '1m'] as const) {
      const response = await app.server.inject({
        method: 'GET',
        url: `/v1/markets/ETH-USD/candles?interval=${interval}`,
      });
      const body = CandleHistoryResponseSchema.parse(response.json());
      const starts = body.candles.map((candle) => candle.startTime);
      expect(starts, interval).toEqual([...starts].sort((a, b) => a - b));
      expect(new Set(starts).size, interval).toBe(starts.length);
    }
  });

  it('clamps limit rather than rejecting it, and defaults to the maximum', async () => {
    const huge = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=1s&limit=99999',
    });
    expect(huge.statusCode).toBe(200);
    expect(CandleHistoryResponseSchema.parse(huge.json()).candles.length).toBeLessThanOrEqual(
      CANDLE_HISTORY_LIMIT_MAX,
    );

    const small = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=1s&limit=5',
    });
    expect(CandleHistoryResponseSchema.parse(small.json()).candles).toHaveLength(5);

    const none = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=1s',
    });
    expect(CandleHistoryResponseSchema.parse(none.json()).candles.length).toBeLessThanOrEqual(
      CANDLE_HISTORY_LIMIT_MAX,
    );
  });

  it('treats an empty history as a valid response, not an error', async () => {
    const empty = await createTestApp();
    const response = await empty.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=1m',
    });
    expect(response.statusCode).toBe(200);
    expect(CandleHistoryResponseSchema.parse(response.json()).candles).toEqual([]);
    await empty.close();
  });

  it('names the field that broke', async () => {
    const badInterval = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=2s',
    });
    expect(badInterval.statusCode).toBe(400);
    expect(RestErrorResponseSchema.parse(badInterval.json()).code).toBe('INVALID_INTERVAL');

    const badLimit = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/BTC-USD/candles?interval=1s&limit=zero',
    });
    expect(badLimit.statusCode).toBe(400);
    expect(RestErrorResponseSchema.parse(badLimit.json()).code).toBe('INVALID_MESSAGE');

    const badSymbol = await app.server.inject({
      method: 'GET',
      url: '/v1/markets/DOGE-USD/candles?interval=1s',
    });
    expect(badSymbol.statusCode).toBe(404);
    expect(RestErrorResponseSchema.parse(badSymbol.json()).code).toBe('UNKNOWN_SYMBOL');
  });
});

describe('POST /v1/auth/ticket', () => {
  it('mints a schema-valid ticket that expires in 60 s', async () => {
    const before = Date.now();
    const response = await app.server.inject({ method: 'POST', url: '/v1/auth/ticket' });
    expect(response.statusCode).toBe(200);
    const body = TicketResponseSchema.parse(response.json());
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);

    const verified = app.context.tickets?.verifyAndConsume(body.ticket);
    expect(verified?.ok).toBe(true);
  });

  it('mints a fresh subject every time — a ticket is never reused', async () => {
    const first = await app.server.inject({ method: 'POST', url: '/v1/auth/ticket' });
    const second = await app.server.inject({ method: 'POST', url: '/v1/auth/ticket' });
    expect(TicketResponseSchema.parse(first.json()).ticket).not.toBe(
      TicketResponseSchema.parse(second.json()).ticket,
    );
  });

  it('still mints with AUTH_MODE=off so the client flow is identical locally', async () => {
    const local = await createTestApp({ authMode: 'off' });
    const response = await local.server.inject({ method: 'POST', url: '/v1/auth/ticket' });
    expect(response.statusCode).toBe(200);
    expect(() => TicketResponseSchema.parse(response.json())).not.toThrow();
    await local.close();
  });
});

describe('CORS', () => {
  it('allows the configured origin and refuses another', async () => {
    const allowed = await app.server.inject({
      method: 'GET',
      url: '/v1/markets',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const denied = await app.server.inject({
      method: 'GET',
      url: '/v1/markets',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('throttles market reads per IP and leaves health alone', async () => {
    const limited = await createTestApp();
    let lastStatus = 200;
    for (let request = 0; request < 121; request += 1) {
      const response = await limited.server.inject({ method: 'GET', url: '/v1/markets' });
      lastStatus = response.statusCode;
      if (lastStatus === 429) {
        const body = RestErrorResponseSchema.parse(response.json());
        expect(body.code).toBe('RATE_LIMITED');
        expect(body.retryAfterMs).toBeGreaterThan(0);
        break;
      }
    }
    expect(lastStatus).toBe(429);

    // Monitoring must never be throttled.
    for (let request = 0; request < 50; request += 1) {
      expect((await limited.server.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(
        200,
      );
    }
    await limited.close();
  });
});

describe('GET /metrics', () => {
  it('exposes symbol-labelled Prometheus counters', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    const body = response.body;
    expect(body).toContain('# TYPE trades_generated counter');
    expect(body).toMatch(/trades_generated\{symbol="BTC-USD"\} [1-9]/);
    expect(body).toMatch(/book_sequence\{symbol="HYPE-USD"\} [1-9]/);
    expect(body).toContain('auth_tickets_issued');
  });
});
