import type { Interval, MarketSymbol } from '@repo/protocol';
import type { DomainTrade } from '../events.js';
import { CandleAggregator } from './aggregator.js';
import { CANDLE_HISTORY_CAPACITY, type DomainCandle } from './candle.js';

/** The intervals every symbol aggregates — three per symbol, fifteen in total. */
export const CANDLE_INTERVALS: readonly Interval[] = Object.freeze(['1s', '5s', '1m']);

/**
 * The three aggregators belonging to one symbol.
 *
 * A trade fans out to its **own symbol's** three aggregators and no others
 * (docs/02-market-domain.md §8).
 */
export class SymbolCandleSet {
  readonly symbol: MarketSymbol;
  readonly #aggregators = new Map<Interval, CandleAggregator>();

  constructor(
    symbol: MarketSymbol,
    intervals: readonly Interval[] = CANDLE_INTERVALS,
    capacity = CANDLE_HISTORY_CAPACITY,
  ) {
    this.symbol = symbol;
    for (const interval of intervals) {
      this.#aggregators.set(interval, new CandleAggregator(symbol, interval, capacity));
    }
  }

  get intervals(): Interval[] {
    return [...this.#aggregators.keys()];
  }

  get(interval: Interval): CandleAggregator | undefined {
    return this.#aggregators.get(interval);
  }

  /** Closes any bucket that has ended by `timestamp`, on every interval. */
  closeThrough(timestamp: number): DomainCandle[] {
    const finalised: DomainCandle[] = [];
    for (const aggregator of this.#aggregators.values()) {
      const candle = aggregator.closeThrough(timestamp);
      if (candle !== null) finalised.push(candle);
    }
    return finalised;
  }

  /** Folds one trade into all three intervals. */
  apply(trade: DomainTrade): DomainCandle[] {
    const finalised: DomainCandle[] = [];
    for (const aggregator of this.#aggregators.values()) {
      const candle = aggregator.apply(trade);
      if (candle !== null) finalised.push(candle);
    }
    return finalised;
  }

  /** The open bucket for each interval that currently has one. */
  active(): DomainCandle[] {
    const candles: DomainCandle[] = [];
    for (const aggregator of this.#aggregators.values()) {
      if (aggregator.active !== null) candles.push(aggregator.active);
    }
    return candles;
  }
}
