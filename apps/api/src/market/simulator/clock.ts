/**
 * The logical market clock. Correctness must not depend on `setInterval` firing
 * on time — it will not (docs/02-market-domain.md §4).
 *
 * The clock counts ticks. The wall clock's only job is to answer "how many
 * logical ticks are owed by now?". A stalled event loop changes *when* ticks are
 * processed, never *which* ticks occur or in what order.
 */
export class LogicalClock {
  readonly tickMs: number;
  readonly startTime: number;
  #tick = 0;

  constructor(options: { readonly tickMs: number; readonly startTime: number }) {
    if (!Number.isInteger(options.tickMs) || options.tickMs <= 0) {
      throw new RangeError(`tickMs must be a positive integer, received ${options.tickMs}`);
    }
    if (!Number.isInteger(options.startTime) || options.startTime < 0) {
      throw new RangeError(`startTime must be a non-negative integer`);
    }
    this.tickMs = options.tickMs;
    this.startTime = options.startTime;
  }

  /** Number of ticks already processed. */
  get tick(): number {
    return this.#tick;
  }

  /** Logical timestamp of tick `n`. */
  timeAt(tick: number): number {
    return this.startTime + tick * this.tickMs;
  }

  /** Logical timestamp the next tick will carry. */
  get now(): number {
    return this.timeAt(this.#tick);
  }

  /** How many ticks should have run by `wallNowMs` but have not. */
  owedTicks(wallNowMs: number): number {
    const elapsed = wallNowMs - this.startTime;
    if (elapsed < 0) return 0;
    return Math.max(0, Math.floor(elapsed / this.tickMs) - this.#tick);
  }

  /** Runs one tick and returns the logical timestamp it carried. */
  advance(): number {
    const timestamp = this.now;
    this.#tick += 1;
    return timestamp;
  }
}
