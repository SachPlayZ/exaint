import type { SymbolTickResult } from '../market/events.js';
import type { MarketEngine } from '../market/market-engine.js';
import { METRIC, type MetricsRegistry } from '../observability/metrics.js';

/**
 * Drives the logical clock from wall time and fans each tick out to listeners.
 *
 * The timer is not the market clock: it only asks the engine how many logical
 * ticks are owed. A late or coalesced timer changes when work happens, never
 * which ticks happen (docs/02-market-domain.md §4).
 */
export class MarketRuntime {
  readonly engine: MarketEngine;
  readonly #metrics: MetricsRegistry | undefined;
  readonly #maxCatchUpTicks: number;
  readonly #listeners = new Set<(result: SymbolTickResult) => void>();
  #timer: NodeJS.Timeout | undefined;

  constructor(options: {
    readonly engine: MarketEngine;
    readonly metrics?: MetricsRegistry;
    readonly maxCatchUpTicks: number;
  }) {
    this.engine = options.engine;
    this.#metrics = options.metrics;
    this.#maxCatchUpTicks = options.maxCatchUpTicks;
  }

  /** Returns an unsubscribe function — see docs/04-frontend.md §14 on teardown discipline. */
  subscribe(listener: (result: SymbolTickResult) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => this.pump(Date.now()), this.engine.clock.tickMs);
    this.#timer.unref?.();
    // Produce the opening tick immediately so /readyz does not wait a full
    // interval on a cold start.
    this.pump(this.engine.clock.startTime);
  }

  stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Runs the ticks owed by `wallNowMs`, bounded so one stall cannot block the loop. */
  pump(wallNowMs: number): number {
    return this.engine.runOwedTicks(
      wallNowMs,
      (result) => this.#dispatch(result),
      this.#maxCatchUpTicks,
    );
  }

  #dispatch(result: SymbolTickResult): void {
    const metrics = this.#metrics;
    if (metrics !== undefined) {
      const labels = { symbol: result.symbol };
      if (result.trades.length > 0) {
        metrics.increment(METRIC.tradesGenerated, labels, result.trades.length);
      }
      if (result.finalisedCandles.length > 0) {
        metrics.increment(METRIC.candleUpdatesGenerated, labels, result.finalisedCandles.length);
      }
      if (result.delta !== null) {
        metrics.setGauge(METRIC.bookSequence, labels, Number(result.delta.sequence));
      }
    }
    for (const listener of this.#listeners) listener(result);
  }
}
