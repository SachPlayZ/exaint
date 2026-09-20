import { describe, expect, it } from 'vitest';
import { Prng, deriveSymbolSeed, fnv1a64, splitmix64 } from '../../src/market/simulator/prng.js';
import { DEFAULT_SYMBOLS } from '../../src/market/symbol-config.js';

describe('fnv1a64', () => {
  it('matches the published FNV-1a 64 test vectors', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
    expect(fnv1a64('a')).toBe(0xaf63dc4c8601ec8cn);
    expect(fnv1a64('foobar')).toBe(0x85944171f73967e8n);
  });
});

describe('splitmix64', () => {
  it('matches the reference output sequence from state 0', () => {
    const outputs: bigint[] = [];
    let state = 0n;
    for (let index = 0; index < 3; index += 1) {
      const step = splitmix64(state);
      state = step.state;
      outputs.push(step.value);
    }
    expect(outputs).toEqual([0xe220a8397b1dcdafn, 0x6e789e6aa1b965f4n, 0x06c45d188009454fn]);
  });
});

describe('deriveSymbolSeed', () => {
  it('is deterministic and gives every symbol its own stream', () => {
    const seeds = DEFAULT_SYMBOLS.map((symbol) => deriveSymbolSeed(1337n, symbol));
    expect(seeds).toEqual(DEFAULT_SYMBOLS.map((symbol) => deriveSymbolSeed(1337n, symbol)));
    expect(new Set(seeds).size).toBe(DEFAULT_SYMBOLS.length);
  });

  it('changes every symbol when MARKET_SEED changes', () => {
    for (const symbol of DEFAULT_SYMBOLS) {
      expect(deriveSymbolSeed(1337n, symbol)).not.toBe(deriveSymbolSeed(1338n, symbol));
    }
  });
});

describe('Prng', () => {
  it('replays identically from the same seed and diverges from another', () => {
    const draw = (seed: bigint): bigint[] => {
      const prng = new Prng(seed);
      return Array.from({ length: 64 }, () => prng.nextUint64());
    };
    expect(draw(1n)).toEqual(draw(1n));
    expect(draw(1n)).not.toEqual(draw(2n));
  });

  it('keeps nextFloat in [0, 1)', () => {
    const prng = new Prng(7n);
    for (let index = 0; index < 5_000; index += 1) {
      const value = prng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('draws uniformly within an inclusive range and reaches both ends', () => {
    const prng = new Prng(11n);
    const counts = new Map<bigint, number>();
    for (let index = 0; index < 20_000; index += 1) {
      const value = prng.nextBigIntBetween(-2n, 3n);
      expect(value).toBeGreaterThanOrEqual(-2n);
      expect(value).toBeLessThanOrEqual(3n);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Six buckets over 20k draws: a biased generator would show up immediately.
    for (const count of counts.values()) expect(count).toBeGreaterThan(2_800);
  });

  it('produces a centred, bounded bell step with no floating-point maths', () => {
    const prng = new Prng(13n);
    let total = 0n;
    for (let index = 0; index < 20_000; index += 1) {
      const step = prng.nextBellBetween(300n);
      expect(step).toBeGreaterThanOrEqual(-300n);
      expect(step).toBeLessThanOrEqual(300n);
      total += step;
    }
    expect(Number(total) / 20_000).toBeCloseTo(0, 0);
  });

  it('rejects degenerate inputs rather than silently misbehaving', () => {
    const prng = new Prng(1n);
    expect(() => prng.nextBigIntBelow(0n)).toThrow(RangeError);
    expect(() => prng.nextBigIntBetween(5n, 4n)).toThrow(RangeError);
    expect(() => prng.nextBellBetween(-1n)).toThrow(RangeError);
    expect(() => prng.pick([])).toThrow(RangeError);
    expect(prng.nextBellBetween(0n)).toBe(0n);
  });
});
