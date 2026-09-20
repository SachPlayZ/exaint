/**
 * Client-side RTT and jitter, smoothed with an EWMA at α = 0.2
 * (docs/03-adaptive-delivery.md §4).
 *
 * The server does **not** smooth again: its hysteresis thresholds are stated
 * against these reported numbers.
 */

export const EWMA_ALPHA = 0.2;

export interface LatencySample {
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly samples: number;
}

export class LatencyTracker {
  #rttMs = 0;
  #jitterMs = 0;
  #previousRttMs: number | null = null;
  #samplesSinceReport = 0;
  #initialised = false;

  /** Folds in one round-trip measurement. Durations only — never `Date.now()`. */
  record(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;

    if (!this.#initialised) {
      this.#rttMs = rttMs;
      this.#initialised = true;
    } else {
      this.#rttMs = EWMA_ALPHA * rttMs + (1 - EWMA_ALPHA) * this.#rttMs;
    }

    if (this.#previousRttMs !== null) {
      const difference = Math.abs(rttMs - this.#previousRttMs);
      this.#jitterMs = EWMA_ALPHA * difference + (1 - EWMA_ALPHA) * this.#jitterMs;
    }
    this.#previousRttMs = rttMs;
    this.#samplesSinceReport += 1;
  }

  get rttMs(): number {
    return this.#rttMs;
  }

  get jitterMs(): number {
    return this.#jitterMs;
  }

  get hasSample(): boolean {
    return this.#initialised;
  }

  /**
   * Builds the next `network.report` and resets the sample counter. `null` when
   * nothing new has been measured — reporting a stale number would tell the
   * server the link is fine when it has gone quiet.
   */
  takeReport(): LatencySample | null {
    if (this.#samplesSinceReport === 0) return null;
    const report = {
      rttMs: Math.round(this.#rttMs * 10) / 10,
      jitterMs: Math.round(this.#jitterMs * 10) / 10,
      samples: this.#samplesSinceReport,
    };
    this.#samplesSinceReport = 0;
    return report;
  }

  /** A new socket measures a new link; carrying the old EWMA over would lie. */
  reset(): void {
    this.#rttMs = 0;
    this.#jitterMs = 0;
    this.#previousRttMs = null;
    this.#samplesSinceReport = 0;
    this.#initialised = false;
  }
}
