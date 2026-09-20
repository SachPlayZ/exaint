import { describe, expect, it } from 'vitest';
import { ConnectionRateLimiter, FRAME_BUCKETS } from '../../src/websocket/rate-limiter.js';

/** T7, rate-limiter half. Driven by a fake clock — a test that sleeps flakes in CI. */
function buildLimiter(clock: { value: number }, strikeLimit = 3): ConnectionRateLimiter {
  return new ConnectionRateLimiter({
    globalPerSecond: 20,
    strikeLimit,
    now: () => clock.value,
  });
}

describe('ConnectionRateLimiter', () => {
  it('pins the budgets from docs/01-protocol.md §8', () => {
    expect(FRAME_BUCKETS).toEqual({
      ping: { sustained: 2, burst: 4 },
      'network.report': { sustained: 1, burst: 3 },
      subscribe: { sustained: 5, burst: 10 },
      unsubscribe: { sustained: 5, burst: 10 },
      set_interval: { sustained: 5, burst: 10 },
      'debug.tier_override': { sustained: 2, burst: 5 },
    });
  });

  it('never limits a well-behaved client pinging every 2 s', () => {
    const clock = { value: 0 };
    const limiter = buildLimiter(clock);
    for (let index = 0; index < 500; index += 1) {
      expect(limiter.check('ping'), `ping ${index}`).toBe('allow');
      clock.value += 2_000;
    }
    expect(limiter.strikes).toBe(0);
  });

  it('lets a burst of 10 pings through 4 at a time, then limits', () => {
    const clock = { value: 0 };
    const limiter = buildLimiter(clock, 100);
    const verdicts = Array.from({ length: 10 }, () => limiter.check('ping'));
    expect(verdicts.slice(0, 4)).toEqual(['allow', 'allow', 'allow', 'allow']);
    expect(verdicts.slice(4)).toEqual(Array<string>(6).fill('limit'));
  });

  it('refills the bucket by elapsed time rather than by request count', () => {
    const clock = { value: 0 };
    const limiter = buildLimiter(clock, 100);
    for (let index = 0; index < 4; index += 1) expect(limiter.check('ping')).toBe('allow');
    expect(limiter.check('ping')).toBe('limit');

    // 2 tokens per second: half a second buys exactly one.
    clock.value += 500;
    expect(limiter.tokensFor('ping')).toBeCloseTo(1, 5);
    expect(limiter.check('ping')).toBe('allow');
    expect(limiter.check('ping')).toBe('limit');

    // The bucket never fills beyond its burst size.
    clock.value += 60_000;
    expect(limiter.tokensFor('ping')).toBe(4);
  });

  it('closes on 3 strikes inside 10 s', () => {
    const clock = { value: 0 };
    const limiter = buildLimiter(clock);
    for (let index = 0; index < 4; index += 1) limiter.check('ping');
    expect(limiter.check('ping')).toBe('limit');
    expect(limiter.check('ping')).toBe('limit');
    expect(limiter.check('ping')).toBe('close');
  });

  it('forgets strikes older than the 10 s window', () => {
    const clock = { value: 0 };
    const limiter = buildLimiter(clock);
    for (let index = 0; index < 4; index += 1) limiter.check('ping');
    expect(limiter.check('ping')).toBe('limit');
    expect(limiter.strikes).toBe(1);

    clock.value += 10_001;
    expect(limiter.strikes).toBe(0);
  });

  it('keeps buckets independent per frame type, under one global budget', () => {
    const clock = { value: 0 };
    const limiter = buildLimiter(clock, 100);
    for (let index = 0; index < 4; index += 1) expect(limiter.check('ping')).toBe('allow');
    expect(limiter.check('ping')).toBe('limit');
    // A different frame type has its own tokens.
    expect(limiter.check('subscribe')).toBe('allow');

    // ...but the global bucket eventually stops everything.
    let globalLimited = false;
    for (let index = 0; index < 60; index += 1) {
      if (limiter.check('subscribe') === 'limit') globalLimited = true;
    }
    expect(globalLimited).toBe(true);
  });
});
