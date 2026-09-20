import type { SymbolTickResult } from './events.js';
import { LogicalClock } from './simulator/clock.js';
import type { SymbolRegistry } from './symbol-registry.js';

/** Called once per symbol per logical tick, in registry order. */
export type TickSink = (result: SymbolTickResult) => void;

/**
 * Owns the single logical clock and advances every `SymbolEngine` with it.
 *
 * Five `setInterval`s would give five drifting clocks. One clock, asked "how
 * many ticks are owed?", gives five engines that stay in lockstep across an
 * event-loop stall (docs/02-market-domain.md §4).
 */
export class MarketEngine {
  readonly clock: LogicalClock;
  readonly registry: SymbolRegistry;

  constructor(options: {
    readonly registry: SymbolRegistry;
    readonly tickMs: number;
    readonly startTime: number;
  }) {
    this.registry = options.registry;
    this.clock = new LogicalClock({ tickMs: options.tickMs, startTime: options.startTime });
  }

  /** True once **every** engine has produced its first tick — gates `/readyz`. */
  get ready(): boolean {
    return this.registry.engines().every((engine) => engine.hasTicked);
  }

  /** Runs exactly one logical tick across every symbol, in registry order. */
  advance(sink?: TickSink): SymbolTickResult[] {
    const timestamp = this.clock.advance();
    const results: SymbolTickResult[] = [];
    for (const engine of this.registry.engines()) {
      const result = engine.tick(timestamp);
      results.push(result);
      sink?.(result);
    }
    return results;
  }

  /**
   * Runs every tick owed by `wallNowMs`. The wall clock decides *when* work
   * happens; the logical clock decides *which* ticks happen, and in what order.
   * Returns the number of ticks run.
   */
  runOwedTicks(wallNowMs: number, sink?: TickSink): number {
    const owed = this.clock.owedTicks(wallNowMs);
    for (let index = 0; index < owed; index += 1) this.advance(sink);
    return owed;
  }
}
