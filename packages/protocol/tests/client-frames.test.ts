import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../src/auth.js';
import {
  CLIENT_FRAME_TYPES,
  INITIAL_TIER,
  TIER_CADENCE_MS,
  decodeClientFrame,
  decodeServerFrame,
} from '../src/websocket.js';

const encode = (value: unknown): string => JSON.stringify(value);

describe('decodeClientFrame — accepted frames', () => {
  it('accepts every client frame type in docs/01-protocol.md §5', () => {
    const frames: unknown[] = [
      {
        type: 'subscribe',
        symbol: 'SOL-USD',
        channels: ['book', 'trades', 'candles'],
        interval: '1s',
      },
      { type: 'subscribe', symbol: 'SOL-USD', channels: ['book'] },
      { type: 'unsubscribe', symbol: 'SOL-USD' },
      { type: 'set_interval', symbol: 'BTC-USD', interval: '1m' },
      { type: 'ping', id: '1192' },
      { type: 'network.report', rttMs: 82.4, jitterMs: 11.8, samples: 12 },
      { type: 'debug.tier_override', tier: 'minimal' },
      { type: 'debug.tier_override', tier: null },
    ];
    const seen = new Set<string>();
    for (const frame of frames) {
      const result = decodeClientFrame(encode(frame));
      expect(result, encode(frame)).toMatchObject({ ok: true });
      if (result.ok) seen.add(result.frame.type);
    }
    expect([...seen].sort()).toEqual([...CLIENT_FRAME_TYPES].sort());
  });

  it('keeps `tier: null` distinguishable from an absent override', () => {
    const result = decodeClientFrame(encode({ type: 'debug.tier_override', tier: null }));
    expect(
      result.ok && result.frame.type === 'debug.tier_override' && result.frame.tier,
    ).toBeNull();
    expect(decodeClientFrame(encode({ type: 'debug.tier_override' })).ok).toBe(false);
  });

  it('ignores unknown extra fields — additive fields are not breaking (§9)', () => {
    const result = decodeClientFrame(encode({ type: 'ping', id: '7', futureField: true }));
    expect(result.ok).toBe(true);
  });
});

describe('decodeClientFrame — malformed frames map to documented codes', () => {
  const cases: ReadonlyArray<readonly [string, string, ErrorCode]> = [
    ['not JSON at all', 'not json', 'INVALID_MESSAGE'],
    ['a JSON array', '[{"type":"ping","id":"1"}]', 'INVALID_MESSAGE'],
    ['JSON null', 'null', 'INVALID_MESSAGE'],
    ['a bare string', '"ping"', 'INVALID_MESSAGE'],
    ['no type field', encode({ symbol: 'BTC-USD' }), 'INVALID_MESSAGE'],
    ['a non-string type', encode({ type: 7 }), 'INVALID_MESSAGE'],
    ['an unknown type', encode({ type: 'subscribe_all' }), 'UNKNOWN_TYPE'],
    ['a server frame sent by the client', encode({ type: 'hello' }), 'UNKNOWN_TYPE'],
    [
      'an interval outside 1s|5s|1m',
      encode({ type: 'set_interval', symbol: 'BTC-USD', interval: '2s' }),
      'INVALID_INTERVAL',
    ],
    [
      'candles requested without an interval',
      encode({ type: 'subscribe', symbol: 'BTC-USD', channels: ['candles'] }),
      'INVALID_INTERVAL',
    ],
    [
      'a channel outside book|trades|candles',
      encode({ type: 'subscribe', symbol: 'BTC-USD', channels: ['ticker'] }),
      'INVALID_CHANNEL',
    ],
    [
      'an empty channel list',
      encode({ type: 'subscribe', symbol: 'BTC-USD', channels: [] }),
      'INVALID_CHANNEL',
    ],
    [
      'a malformed symbol',
      encode({ type: 'subscribe', symbol: 'btc usd', channels: ['book'] }),
      'INVALID_MESSAGE',
    ],
    ['a ping without an id', encode({ type: 'ping' }), 'INVALID_MESSAGE'],
    [
      'a negative rtt',
      encode({ type: 'network.report', rttMs: -1, jitterMs: 0, samples: 1 }),
      'INVALID_MESSAGE',
    ],
    [
      // Written as raw JSON: JSON.parse turns the overflowing literal into Infinity.
      'a non-finite rtt',
      '{"type":"network.report","rttMs":1e999,"jitterMs":0,"samples":1}',
      'INVALID_MESSAGE',
    ],
    ['an unknown tier', encode({ type: 'debug.tier_override', tier: 'turbo' }), 'INVALID_MESSAGE'],
  ];

  it.each(cases)('rejects %s with %#', (_label, raw, code) => {
    const result = decodeClientFrame(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it('rejects an oversized frame without parsing it', () => {
    const huge = encode({ type: 'ping', id: '1192', padding: 'x'.repeat(10_000) });
    const result = decodeClientFrame(huge, { maxBytes: 8192 });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(decodeClientFrame(huge).ok).toBe(true);
  });

  it('never throws on garbage — a bad frame is a value, not an exception', () => {
    const garbage = [
      '',
      '{',
      '}{',
      '\u0000',
      '{"type":}',
      '{"type":"ping","id":null}',
      '{"type":"subscribe","symbol":null,"channels":null}',
      '[[[[[[',
      '{"__proto__":{"polluted":true},"type":"ping","id":"1"}',
      '{"type":"network.report","rttMs":"82.4","jitterMs":"11.8","samples":"12"}',
      JSON.stringify({ type: 'subscribe', symbol: 'BTC-USD', channels: ['book'], interval: 5 }),
    ];
    for (const raw of garbage) {
      expect(() => decodeClientFrame(raw), raw).not.toThrow();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('decodeServerFrame', () => {
  it('accepts a hello frame', () => {
    const result = decodeServerFrame(
      encode({
        type: 'hello',
        protocolVersion: 'v1',
        connectionId: 'conn-7f3a',
        serverTime: 1789874705123,
        tier: INITIAL_TIER,
        symbols: [
          {
            symbol: 'BTC-USD',
            priceScale: 4,
            quantityScale: 8,
            tickSize: '0.1000',
            bookDepth: 25,
          },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects an unknown server frame type', () => {
    expect(decodeServerFrame(encode({ type: 'ticker', symbol: 'BTC-USD' }))).toMatchObject({
      ok: false,
      code: 'INVALID_MESSAGE',
    });
  });
});

describe('tier constants', () => {
  it('pins the cadences from docs/03-adaptive-delivery.md §2', () => {
    expect(TIER_CADENCE_MS).toEqual({
      full: { candlesUpdateMs: 100, tradesBatchMs: 200 },
      degraded: { candlesUpdateMs: 500, tradesBatchMs: 500 },
      minimal: { candlesUpdateMs: 2000, tradesBatchMs: 2000 },
    });
  });

  it('starts new connections at DEGRADED, not FULL', () => {
    expect(INITIAL_TIER).toBe('degraded');
  });
});
