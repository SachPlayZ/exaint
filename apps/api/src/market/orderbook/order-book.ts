import type { MarketSymbol } from '@repo/protocol';
import type { DomainBookDelta, DomainBookLevel, DomainBookSnapshot } from '../events.js';

export type BookSide = 'bid' | 'ask';

/**
 * Canonical order book for **one** symbol.
 *
 * It owns its own `bookSequence`, which increments by exactly 1 per emitted
 * delta and is unrelated to any other symbol's (I1, docs/02-market-domain.md §7).
 *
 * The book holds exactly the visible window: `depth` levels per side, no more.
 * That is what makes a delta chain reproduce the authoritative book byte for
 * byte on the client — there is no hidden liquidity outside the window for a
 * delta to silently reveal.
 */
export class OrderBook {
  readonly symbol: MarketSymbol;
  readonly depth: number;

  readonly #bids = new Map<bigint, bigint>();
  readonly #asks = new Map<bigint, bigint>();

  /** Level values as they were at the start of the current tick, per side. */
  readonly #touchedBids = new Map<bigint, bigint>();
  readonly #touchedAsks = new Map<bigint, bigint>();

  #sequence = 0n;

  constructor(symbol: MarketSymbol, depth: number) {
    if (!Number.isInteger(depth) || depth <= 0) {
      throw new RangeError(`depth must be a positive integer, received ${depth}`);
    }
    this.symbol = symbol;
    this.depth = depth;
  }

  get sequence(): bigint {
    return this.#sequence;
  }

  #side(side: BookSide): Map<bigint, bigint> {
    return side === 'bid' ? this.#bids : this.#asks;
  }

  #touched(side: BookSide): Map<bigint, bigint> {
    return side === 'bid' ? this.#touchedBids : this.#touchedAsks;
  }

  /** Prices best-first: bids descending, asks ascending. */
  prices(side: BookSide): bigint[] {
    const keys = [...this.#side(side).keys()];
    keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return side === 'bid' ? keys.reverse() : keys;
  }

  levels(side: BookSide): DomainBookLevel[] {
    const map = this.#side(side);
    return this.prices(side).map((price) => [price, map.get(price) ?? 0n] as const);
  }

  best(side: BookSide): bigint | undefined {
    return this.prices(side)[0];
  }

  bestBid(): bigint | undefined {
    return this.best('bid');
  }

  bestAsk(): bigint | undefined {
    return this.best('ask');
  }

  size(side: BookSide): number {
    return this.#side(side).size;
  }

  quantityAt(side: BookSide, price: bigint): bigint {
    return this.#side(side).get(price) ?? 0n;
  }

  /** Sets a level outright. Quantity `0n` deletes it. */
  setLevel(side: BookSide, price: bigint, quantity: bigint): void {
    if (quantity < 0n) throw new RangeError(`quantity must not be negative: ${quantity}`);
    const levels = this.#side(side);
    const touched = this.#touched(side);
    if (!touched.has(price)) touched.set(price, levels.get(price) ?? 0n);
    if (quantity === 0n) levels.delete(price);
    else levels.set(price, quantity);
  }

  /** Adds to a level, clamping at zero. */
  addQuantity(side: BookSide, price: bigint, delta: bigint): void {
    const next = this.quantityAt(side, price) + delta;
    this.setLevel(side, price, next > 0n ? next : 0n);
  }

  /** Drops the levels furthest from the mid until the side fits the window. */
  trim(): void {
    for (const side of ['bid', 'ask'] as const) {
      const prices = this.prices(side);
      for (const price of prices.slice(this.depth)) this.setLevel(side, price, 0n);
    }
  }

  snapshot(): DomainBookSnapshot {
    return {
      symbol: this.symbol,
      sequence: this.#sequence,
      bids: this.levels('bid'),
      asks: this.levels('ask'),
    };
  }

  /**
   * Emits everything that genuinely changed since the last flush, as one delta,
   * and burns one sequence number. Returns `null` when nothing changed —
   * a no-op tick must not advance the sequence, or every client would see a gap.
   */
  flushDelta(timestamp: number): DomainBookDelta | null {
    const bids = this.#collectChanges('bid');
    const asks = this.#collectChanges('ask');
    this.#touchedBids.clear();
    this.#touchedAsks.clear();

    if (bids.length === 0 && asks.length === 0) return null;

    const previousSequence = this.#sequence;
    this.#sequence = previousSequence + 1n;
    return {
      symbol: this.symbol,
      previousSequence,
      sequence: this.#sequence,
      timestamp,
      bids,
      asks,
    };
  }

  /** Discards pending changes without emitting — used to seed the opening book. */
  clearPendingChanges(): void {
    this.#touchedBids.clear();
    this.#touchedAsks.clear();
  }

  #collectChanges(side: BookSide): DomainBookLevel[] {
    const levels = this.#side(side);
    const changes: DomainBookLevel[] = [];
    for (const [price, before] of this.#touched(side)) {
      const after = levels.get(price) ?? 0n;
      // A level touched and put back exactly as it was is not a change.
      if (after !== before) changes.push([price, after]);
    }
    changes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return side === 'bid' ? changes.reverse() : changes;
  }
}
