import type { DomainCandle } from './candle.js';

/**
 * Fixed-capacity history of finalised candles, oldest evicted first.
 *
 * A plain array with `shift()` would be O(n) per close, 15 times per second per
 * symbol. This is O(1).
 */
export class CandleRingBuffer {
  readonly capacity: number;
  readonly #slots: (DomainCandle | undefined)[];
  #next = 0;
  #size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, received ${capacity}`);
    }
    this.capacity = capacity;
    this.#slots = new Array<DomainCandle | undefined>(capacity).fill(undefined);
  }

  get size(): number {
    return this.#size;
  }

  push(candle: DomainCandle): void {
    this.#slots[this.#next] = candle;
    this.#next = (this.#next + 1) % this.capacity;
    if (this.#size < this.capacity) this.#size += 1;
  }

  /** Oldest first. */
  toArray(): DomainCandle[] {
    const out: DomainCandle[] = [];
    const first = (this.#next - this.#size + this.capacity) % this.capacity;
    for (let offset = 0; offset < this.#size; offset += 1) {
      const candle = this.#slots[(first + offset) % this.capacity];
      if (candle !== undefined) out.push(candle);
    }
    return out;
  }

  /** The newest `limit` candles, still oldest first. */
  recent(limit: number): DomainCandle[] {
    if (limit <= 0) return [];
    const all = this.toArray();
    return all.slice(Math.max(0, all.length - limit));
  }

  last(): DomainCandle | undefined {
    if (this.#size === 0) return undefined;
    return this.#slots[(this.#next - 1 + this.capacity) % this.capacity];
  }
}
