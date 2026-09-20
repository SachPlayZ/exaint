const WINDOW_MS = 5_000;

/** Counts received frames over the previous five seconds using a monotonic clock. */
export class RollingRate {
  readonly #now: () => number;
  readonly #receivedAt: number[] = [];
  #head = 0;

  constructor(now: () => number) {
    this.#now = now;
  }

  record(): void {
    const now = this.#now();
    this.#prune(now);
    this.#receivedAt.push(now);
  }

  hertz(): number {
    this.#prune(this.#now());
    return (this.#receivedAt.length - this.#head) / (WINDOW_MS / 1_000);
  }

  reset(): void {
    this.#receivedAt.length = 0;
    this.#head = 0;
  }

  #prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    while (this.#head < this.#receivedAt.length) {
      const receivedAt = this.#receivedAt[this.#head];
      if (receivedAt === undefined || receivedAt > cutoff) break;
      this.#head += 1;
    }

    if (this.#head > 64 && this.#head * 2 > this.#receivedAt.length) {
      this.#receivedAt.splice(0, this.#head);
      this.#head = 0;
    }
  }
}
