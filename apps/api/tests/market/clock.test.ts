import { describe, expect, it } from 'vitest';
import { LogicalClock } from '../../src/market/simulator/clock.js';

const START = 1_700_000_000_000;

describe('LogicalClock', () => {
  it('numbers ticks from the start time, 50 ms apart', () => {
    const clock = new LogicalClock({ tickMs: 50, startTime: START });
    expect(clock.tick).toBe(0);
    expect(clock.now).toBe(START);
    expect(clock.advance()).toBe(START);
    expect(clock.advance()).toBe(START + 50);
    expect(clock.tick).toBe(2);
    expect(clock.now).toBe(START + 100);
  });

  it('owes the ticks that wall time has passed but the loop has not run', () => {
    const clock = new LogicalClock({ tickMs: 50, startTime: START });
    expect(clock.owedTicks(START)).toBe(0);
    expect(clock.owedTicks(START + 49)).toBe(0);
    expect(clock.owedTicks(START + 50)).toBe(1);
    expect(clock.owedTicks(START + 999)).toBe(19);
    clock.advance();
    expect(clock.owedTicks(START + 999)).toBe(18);
  });

  it('owes nothing before the start time and never goes negative', () => {
    const clock = new LogicalClock({ tickMs: 50, startTime: START });
    expect(clock.owedTicks(START - 5_000)).toBe(0);
    for (let index = 0; index < 5; index += 1) clock.advance();
    expect(clock.owedTicks(START)).toBe(0);
  });

  it('a stall changes when ticks run, never which ticks run or their order', () => {
    const steady = new LogicalClock({ tickMs: 50, startTime: START });
    const stalled = new LogicalClock({ tickMs: 50, startTime: START });

    const steadyTimes: number[] = [];
    for (let wall = START; wall <= START + 1_000; wall += 50) {
      for (let owed = steady.owedTicks(wall); owed > 0; owed -= 1)
        steadyTimes.push(steady.advance());
    }

    // One wake-up after a 1 s freeze has to catch up the identical ticks.
    const stalledTimes: number[] = [];
    for (let owed = stalled.owedTicks(START + 1_000); owed > 0; owed -= 1) {
      stalledTimes.push(stalled.advance());
    }

    expect(stalledTimes).toEqual(steadyTimes);
    expect(steadyTimes).toEqual(Array.from({ length: 20 }, (_, i) => START + i * 50));
  });

  it('rejects a nonsensical configuration', () => {
    expect(() => new LogicalClock({ tickMs: 0, startTime: START })).toThrow(RangeError);
    expect(() => new LogicalClock({ tickMs: 1.5, startTime: START })).toThrow(RangeError);
    expect(() => new LogicalClock({ tickMs: 50, startTime: -1 })).toThrow(RangeError);
  });
});
