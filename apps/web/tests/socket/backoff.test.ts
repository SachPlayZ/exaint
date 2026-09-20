import { describe, expect, it } from 'vitest';
import {
  BACKOFF_MAX_MS,
  BACKOFF_STEPS_MS,
  ERROR_AFTER_ATTEMPTS,
  STABLE_CONNECTION_MS,
  backoffDelayMs,
} from '../../features/market/socket/backoff.js';
import { EWMA_ALPHA, LatencyTracker } from '../../features/market/socket/latency-tracker.js';

describe('backoff', () => {
  it('follows the documented ladder without jitter', () => {
    const noJitter = () => 0.5;
    const delays = BACKOFF_STEPS_MS.map((_, attempt) => backoffDelayMs(attempt, noJitter));
    expect(delays).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000]);
    expect(backoffDelayMs(BACKOFF_STEPS_MS.length, noJitter)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelayMs(99, noJitter)).toBe(BACKOFF_MAX_MS);
  });

  it('spreads reconnects by ±20% so clients do not return in lockstep', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(200);
    expect(backoffDelayMs(0, () => 1)).toBe(300);
    const spread = new Set(
      Array.from({ length: 200 }, (_, index) => backoffDelayMs(2, () => index / 200)),
    );
    expect(spread.size).toBeGreaterThan(50);
    for (const delay of spread) {
      expect(delay).toBeGreaterThanOrEqual(800);
      expect(delay).toBeLessThanOrEqual(1_200);
    }
  });

  it('derives its stability window and error threshold from the ladder', () => {
    expect(STABLE_CONNECTION_MS).toBe(BACKOFF_MAX_MS);
    expect(ERROR_AFTER_ATTEMPTS).toBe(BACKOFF_STEPS_MS.length + 3);
  });
});

describe('LatencyTracker', () => {
  it('seeds from the first sample and then smooths at alpha 0.2', () => {
    const tracker = new LatencyTracker();
    tracker.record(100);
    expect(tracker.rttMs).toBe(100);
    tracker.record(200);
    expect(tracker.rttMs).toBeCloseTo(EWMA_ALPHA * 200 + 0.8 * 100, 6);
  });

  it('smooths jitter from successive differences, starting at zero', () => {
    const tracker = new LatencyTracker();
    tracker.record(100);
    expect(tracker.jitterMs).toBe(0);
    tracker.record(140);
    expect(tracker.jitterMs).toBeCloseTo(EWMA_ALPHA * 40, 6);
  });

  it('reports the sample count and then resets it', () => {
    const tracker = new LatencyTracker();
    for (const rtt of [50, 60, 70]) tracker.record(rtt);
    expect(tracker.takeReport()).toMatchObject({ samples: 3 });
    expect(tracker.takeReport()).toBeNull();
  });

  it('reports nothing rather than a stale number when the link goes quiet', () => {
    const tracker = new LatencyTracker();
    expect(tracker.takeReport()).toBeNull();
  });

  it('ignores impossible samples', () => {
    const tracker = new LatencyTracker();
    tracker.record(-1);
    tracker.record(Number.NaN);
    expect(tracker.hasSample).toBe(false);
  });

  it('forgets everything on reset — a new socket is a new link', () => {
    const tracker = new LatencyTracker();
    tracker.record(500);
    tracker.reset();
    expect(tracker.rttMs).toBe(0);
    expect(tracker.hasSample).toBe(false);
  });
});
