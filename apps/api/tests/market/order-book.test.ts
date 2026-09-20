import { describe, expect, it } from 'vitest';
import type { DomainBookDelta, DomainBookLevel } from '../../src/market/events.js';
import { OrderBook } from '../../src/market/orderbook/order-book.js';

/** A client-side mirror: snapshot, then deltas, exactly as I1 requires. */
class BookMirror {
  sequence: bigint;
  readonly bids = new Map<bigint, bigint>();
  readonly asks = new Map<bigint, bigint>();

  constructor(snapshot: {
    sequence: bigint;
    bids: readonly DomainBookLevel[];
    asks: readonly DomainBookLevel[];
  }) {
    this.sequence = snapshot.sequence;
    for (const [price, quantity] of snapshot.bids) this.bids.set(price, quantity);
    for (const [price, quantity] of snapshot.asks) this.asks.set(price, quantity);
  }

  apply(delta: DomainBookDelta): void {
    if (delta.previousSequence !== this.sequence) {
      throw new Error(`gap: expected ${this.sequence}, delta says ${delta.previousSequence}`);
    }
    for (const [price, quantity] of delta.bids) {
      if (quantity === 0n) this.bids.delete(price);
      else this.bids.set(price, quantity);
    }
    for (const [price, quantity] of delta.asks) {
      if (quantity === 0n) this.asks.delete(price);
      else this.asks.set(price, quantity);
    }
    this.sequence = delta.sequence;
  }

  levels(side: 'bid' | 'ask'): DomainBookLevel[] {
    const map = side === 'bid' ? this.bids : this.asks;
    const entries = [...map.entries()].map(([p, q]) => [p, q] as DomainBookLevel);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return side === 'bid' ? entries.reverse() : entries;
  }
}

describe('OrderBook', () => {
  it('sorts bids descending and asks ascending', () => {
    const book = new OrderBook('BTC-USD', 25);
    book.setLevel('bid', 100n, 1n);
    book.setLevel('bid', 300n, 1n);
    book.setLevel('bid', 200n, 1n);
    book.setLevel('ask', 500n, 1n);
    book.setLevel('ask', 400n, 1n);
    expect(book.prices('bid')).toEqual([300n, 200n, 100n]);
    expect(book.prices('ask')).toEqual([400n, 500n]);
    expect(book.bestBid()).toBe(300n);
    expect(book.bestAsk()).toBe(400n);
  });

  it('treats quantity 0 as a delete and clamps subtraction at zero', () => {
    const book = new OrderBook('BTC-USD', 25);
    book.setLevel('bid', 100n, 5n);
    book.addQuantity('bid', 100n, -2n);
    expect(book.quantityAt('bid', 100n)).toBe(3n);
    book.addQuantity('bid', 100n, -99n);
    expect(book.quantityAt('bid', 100n)).toBe(0n);
    expect(book.size('bid')).toBe(0);
    expect(() => book.setLevel('bid', 100n, -1n)).toThrow(RangeError);
  });

  it('holds exactly the visible window, trimming the levels furthest from the mid', () => {
    const book = new OrderBook('BTC-USD', 3);
    for (const price of [100n, 90n, 80n, 70n, 60n]) book.setLevel('bid', price, 1n);
    book.trim();
    expect(book.prices('bid')).toEqual([100n, 90n, 80n]);
  });

  it('burns no sequence when nothing changed', () => {
    const book = new OrderBook('BTC-USD', 25);
    book.setLevel('bid', 100n, 1n);
    expect(book.flushDelta(1)?.sequence).toBe(1n);
    expect(book.flushDelta(2)).toBeNull();
    expect(book.sequence).toBe(1n);

    // Touched, then put back exactly as it was: not a change.
    book.setLevel('bid', 100n, 5n);
    book.setLevel('bid', 100n, 1n);
    expect(book.flushDelta(3)).toBeNull();
    expect(book.sequence).toBe(1n);
  });

  it('increments the sequence by exactly 1 per emitted delta', () => {
    const book = new OrderBook('BTC-USD', 25);
    const sequences: bigint[] = [];
    for (let index = 0n; index < 20n; index += 1n) {
      book.setLevel('bid', 100n, index + 1n);
      const delta = book.flushDelta(Number(index));
      expect(delta).not.toBeNull();
      if (delta === null) return;
      expect(delta.sequence - delta.previousSequence).toBe(1n);
      sequences.push(delta.sequence);
    }
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => BigInt(i + 1)));
  });

  it('reproduces the authoritative book from snapshot plus delta chain (I1)', () => {
    const book = new OrderBook('BTC-USD', 8);
    for (let index = 0; index < 8; index += 1) {
      book.setLevel('bid', 1000n - BigInt(index) * 10n, BigInt(index + 1));
      book.setLevel('ask', 1010n + BigInt(index) * 10n, BigInt(index + 1));
    }
    book.clearPendingChanges();

    const mirror = new BookMirror(book.snapshot());

    // A scripted churn: adds, resizes, deletes, and an eviction by trim.
    const script: Array<() => void> = [
      () => book.addQuantity('bid', 1000n, 5n),
      () => book.setLevel('ask', 1010n, 0n),
      () => book.setLevel('ask', 1005n, 7n),
      () => book.setLevel('bid', 1005n, 0n),
      () => book.setLevel('bid', 1100n, 3n),
      () => book.addQuantity('ask', 1080n, -1n),
      () => book.setLevel('bid', 930n, 2n),
    ];
    for (const [index, step] of script.entries()) {
      step();
      book.trim();
      const delta = book.flushDelta(index);
      if (delta !== null) mirror.apply(delta);
    }

    expect(mirror.sequence).toBe(book.sequence);
    expect(mirror.levels('bid')).toEqual(book.levels('bid'));
    expect(mirror.levels('ask')).toEqual(book.levels('ask'));
  });

  it('rejects a non-positive depth', () => {
    expect(() => new OrderBook('BTC-USD', 0)).toThrow(RangeError);
  });
});
