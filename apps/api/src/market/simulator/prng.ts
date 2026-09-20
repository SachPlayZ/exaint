/**
 * Deterministic PRNG. `Math.random()` is banned in this layer — a market that
 * cannot be replayed from a seed is a toy (docs/02-market-domain.md §3).
 *
 * splitmix64 both derives per-symbol seeds and generates the streams. It is a
 * well-tested 64-bit generator, and expressing it in `bigint` keeps every draw
 * exact and platform-independent — no floating point anywhere in the state.
 */

const MASK_64 = (1n << 64n) - 1n;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

function mix64(input: bigint): bigint {
  let z = input;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}

/** One splitmix64 step: advances the state and returns the mixed output. */
export function splitmix64(state: bigint): { readonly value: bigint; readonly state: bigint } {
  const next = (state + GOLDEN_GAMMA) & MASK_64;
  return { value: mix64(next), state: next };
}

/** FNV-1a over the UTF-8 bytes of `text`, 64-bit. */
export function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & MASK_64;
  }
  return hash;
}

/**
 * `symbolSeed = splitmix64(MARKET_SEED ⊕ fnv1a(symbol))`.
 *
 * One `MARKET_SEED` reproduces the whole five-symbol universe, while the streams
 * stay independent — changing one symbol's generator cannot perturb another's
 * replay (docs/adr/0006-per-symbol-engines.md).
 */
export function deriveSymbolSeed(marketSeed: bigint, symbol: string): bigint {
  return splitmix64((BigInt.asUintN(64, marketSeed) ^ fnv1a64(symbol)) & MASK_64).value;
}

export class Prng {
  #state: bigint;

  constructor(seed: bigint) {
    this.#state = BigInt.asUintN(64, seed);
  }

  /** Current internal state — lets a test assert that two streams diverge. */
  get state(): bigint {
    return this.#state;
  }

  nextUint64(): bigint {
    const step = splitmix64(this.#state);
    this.#state = step.state;
    return step.value;
  }

  /** Uniform in `[0, 1)`, using the top 53 bits so every double is reachable. */
  nextFloat(): number {
    return Number(this.nextUint64() >> 11n) / 2 ** 53;
  }

  /** Uniform in `[0, bound)`. Rejection sampling, so there is no modulo bias. */
  nextBigIntBelow(bound: bigint): bigint {
    if (bound <= 0n) throw new RangeError(`bound must be positive, received ${bound}`);
    const limit = ((MASK_64 + 1n) / bound) * bound;
    let draw = this.nextUint64();
    while (draw >= limit) draw = this.nextUint64();
    return draw % bound;
  }

  /** Uniform in `[low, high]`, inclusive of both ends. */
  nextBigIntBetween(low: bigint, high: bigint): bigint {
    if (high < low) throw new RangeError(`inverted range [${low}, ${high}]`);
    return low + this.nextBigIntBelow(high - low + 1n);
  }

  /** Uniform integer in `[low, high]`, inclusive. */
  nextIntBetween(low: number, high: number): number {
    return Number(this.nextBigIntBetween(BigInt(low), BigInt(high)));
  }

  nextBoolean(): boolean {
    return (this.nextUint64() & 1n) === 1n;
  }

  /**
   * Bell-shaped integer step in roughly `[-span, span]`, as the mean of three
   * uniform draws.
   *
   * Deliberately not Box–Muller: `Math.log`/`Math.cos` are not bit-identical
   * across JS engines, and a replay test that only holds on one machine is not a
   * determinism test. This is pure integer arithmetic.
   */
  nextBellBetween(span: bigint): bigint {
    if (span < 0n) throw new RangeError('span must not be negative');
    if (span === 0n) return 0n;
    let total = 0n;
    for (let draw = 0; draw < 3; draw += 1) total += this.nextBigIntBetween(-span, span);
    return total / 3n;
  }

  /** Picks an element of a non-empty array. */
  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError('cannot pick from an empty array');
    const chosen = values[this.nextIntBetween(0, values.length - 1)];
    if (chosen === undefined) throw new Error('unreachable: index derived from length');
    return chosen;
  }
}
