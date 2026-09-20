import type { BookLevel, BookSnapshot } from '@repo/protocol';
import { parsePrice, parseQuantity, formatPrice, formatQuantity } from '@repo/protocol';

/**
 * The local mirror of one symbol's book.
 *
 * Prices and quantities are held as `bigint` fixed-point, parsed once at the
 * boundary — the UI formats them back for display and never feeds a converted
 * number into a calculation (docs/02-market-domain.md §5).
 */
export interface DisplayLevel {
  readonly price: bigint;
  readonly quantity: bigint;
  /** Running sum from the touch outward — what the depth bars are drawn from. */
  readonly cumulative: bigint;
}

export class LocalOrderBook {
  readonly #bids = new Map<bigint, bigint>();
  readonly #asks = new Map<bigint, bigint>();

  reset(): void {
    this.#bids.clear();
    this.#asks.clear();
  }

  applySnapshot(snapshot: Pick<BookSnapshot, 'bids' | 'asks'>): void {
    this.reset();
    for (const [price, quantity] of snapshot.bids) this.#set('bid', price, quantity);
    for (const [price, quantity] of snapshot.asks) this.#set('ask', price, quantity);
  }

  applyLevels(bids: readonly BookLevel[], asks: readonly BookLevel[]): void {
    for (const [price, quantity] of bids) this.#set('bid', price, quantity);
    for (const [price, quantity] of asks) this.#set('ask', price, quantity);
  }

  #set(side: 'bid' | 'ask', price: string, quantity: string): void {
    const levels = side === 'bid' ? this.#bids : this.#asks;
    const parsedPrice = parsePrice(price);
    const parsedQuantity = parseQuantity(quantity);
    // Quantity "0" deletes the level — the documented sentinel, not a zero-size rest.
    if (parsedQuantity === 0n) levels.delete(parsedPrice);
    else levels.set(parsedPrice, parsedQuantity);
  }

  size(side: 'bid' | 'ask'): number {
    return (side === 'bid' ? this.#bids : this.#asks).size;
  }

  /** Best-first, with cumulative depth. Bids descend, asks ascend. */
  levels(side: 'bid' | 'ask', limit = Number.POSITIVE_INFINITY): DisplayLevel[] {
    const source = side === 'bid' ? this.#bids : this.#asks;
    const prices = [...source.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (side === 'bid') prices.reverse();

    const out: DisplayLevel[] = [];
    let cumulative = 0n;
    for (const price of prices) {
      if (out.length >= limit) break;
      const quantity = source.get(price) ?? 0n;
      cumulative += quantity;
      out.push({ price, quantity, cumulative });
    }
    return out;
  }

  bestBid(): bigint | undefined {
    return this.levels('bid', 1)[0]?.price;
  }

  bestAsk(): bigint | undefined {
    return this.levels('ask', 1)[0]?.price;
  }

  /** Serialises back to wire shape — used by tests to compare against the server. */
  toWire(): { bids: [string, string][]; asks: [string, string][] } {
    const encode = (side: 'bid' | 'ask'): [string, string][] =>
      this.levels(side).map((level) => [formatPrice(level.price), formatQuantity(level.quantity)]);
    return { bids: encode('bid'), asks: encode('ask') };
  }
}
