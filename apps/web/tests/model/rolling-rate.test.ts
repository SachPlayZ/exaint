import { describe, expect, it } from 'vitest';
import { RollingRate } from '../../features/market/model/rolling-rate.js';

describe('RollingRate', () => {
  it('measures received frames over a rolling five-second window', () => {
    let now = 0;
    const rate = new RollingRate(() => now);

    rate.record();
    now = 1_000;
    rate.record();
    now = 4_999;
    rate.record();
    expect(rate.hertz()).toBe(0.6);

    now = 5_000;
    expect(rate.hertz()).toBe(0.4);
    now = 6_000;
    expect(rate.hertz()).toBe(0.2);
    now = 10_000;
    expect(rate.hertz()).toBe(0);
  });

  it('resets all observations', () => {
    let now = 0;
    const rate = new RollingRate(() => now);
    rate.record();
    now = 100;
    rate.record();

    rate.reset();

    expect(rate.hertz()).toBe(0);
  });
});
