import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BookDeltaFrame, BookSnapshotResponse } from '@repo/protocol';
import { formatPrice, formatQuantity } from '@repo/protocol';
import {
  OrderBookSynchronizer,
  type BookStatus,
} from '../../features/market/orderbook/synchronizer.js';

/** Read through a function so TypeScript does not narrow the getter across steps. */
const statusOf = (sync: OrderBookSynchronizer): BookStatus => sync.status;

/**
 * T4 — property-based order book.
 *
 * > Applying any valid contiguous delta chain must produce the same book as the
 * > authoritative server book.
 * > A gap must always result in resynchronisation.
 */

const SYMBOL = 'BTC-USD';

interface LevelOp {
  readonly side: 'bid' | 'ask';
  readonly priceIndex: number;
  readonly quantity: number;
}

const opArbitrary = fc.record({
  side: fc.constantFrom<'bid' | 'ask'>('bid', 'ask'),
  priceIndex: fc.integer({ min: 0, max: 11 }),
  // 0 is the delete sentinel and must be generated often enough to matter.
  quantity: fc.integer({ min: 0, max: 5 }),
});

const priceFor = (side: 'bid' | 'ask', index: number): bigint =>
  side === 'bid' ? 672_300_000n - BigInt(index) * 1_000n : 672_320_000n + BigInt(index) * 1_000n;

/** The authoritative book, plus the delta chain that reproduces it. */
function buildChain(
  startSequence: number,
  batches: readonly (readonly LevelOp[])[],
): {
  snapshot: BookSnapshotResponse;
  deltas: BookDeltaFrame[];
  finalBids: Map<bigint, bigint>;
  finalAsks: Map<bigint, bigint>;
} {
  const bids = new Map<bigint, bigint>();
  const asks = new Map<bigint, bigint>();
  const deltas: BookDeltaFrame[] = [];

  const apply = (op: LevelOp): [string, string] => {
    const price = priceFor(op.side, op.priceIndex);
    const quantity = BigInt(op.quantity) * 100_000_000n;
    const levels = op.side === 'bid' ? bids : asks;
    if (quantity === 0n) levels.delete(price);
    else levels.set(price, quantity);
    return [formatPrice(price), quantity === 0n ? '0' : formatQuantity(quantity)];
  };

  const snapshot: BookSnapshotResponse = {
    symbol: SYMBOL,
    sequence: String(startSequence),
    bids: [],
    asks: [],
  };

  for (const [index, batch] of batches.entries()) {
    const sequence = startSequence + index + 1;
    const bidLevels: [string, string][] = [];
    const askLevels: [string, string][] = [];
    for (const op of batch) {
      const level = apply(op);
      if (op.side === 'bid') bidLevels.push(level);
      else askLevels.push(level);
    }
    deltas.push({
      type: 'book.delta',
      symbol: SYMBOL,
      previousSequence: String(sequence - 1),
      sequence: String(sequence),
      timestamp: 1_700_000_000_000 + sequence,
      bids: bidLevels,
      asks: askLevels,
    });
  }

  return { snapshot, deltas, finalBids: bids, finalAsks: asks };
}

function authoritativeWire(
  bids: Map<bigint, bigint>,
  asks: Map<bigint, bigint>,
): { bids: [string, string][]; asks: [string, string][] } {
  const encode = (levels: Map<bigint, bigint>, descending: boolean): [string, string][] => {
    const prices = [...levels.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (descending) prices.reverse();
    return prices.map((price) => [formatPrice(price), formatQuantity(levels.get(price) ?? 0n)]);
  };
  return { bids: encode(bids, true), asks: encode(asks, false) };
}

const batchesArbitrary = fc.array(fc.array(opArbitrary, { minLength: 1, maxLength: 3 }), {
  minLength: 1,
  maxLength: 25,
});

describe('T4 — any valid contiguous chain reproduces the authoritative book', () => {
  it('holds when every delta arrives after the snapshot, in order', () => {
    fc.assert(
      fc.property(batchesArbitrary, fc.integer({ min: 0, max: 5_000 }), (batches, start) => {
        const { snapshot, deltas, finalBids, finalAsks } = buildChain(start, batches);
        const sync = new OrderBookSynchronizer(SYMBOL);
        sync.applySnapshot(snapshot, sync.beginSync());
        for (const delta of deltas) {
          if (sync.applyDelta(delta) !== 'applied') return false;
        }
        expect(sync.book.toWire()).toEqual(authoritativeWire(finalBids, finalAsks));
        return sync.status === 'SYNCHRONIZED';
      }),
      { numRuns: 150 },
    );
  });

  it('holds when the chain is buffered first, in arbitrary order, with duplicates', () => {
    fc.assert(
      fc.property(
        batchesArbitrary,
        fc.integer({ min: 0, max: 5_000 }),
        fc.array(fc.integer({ min: 0, max: 24 }), { maxLength: 10 }),
        (batches, start, duplicateAt) => {
          const { snapshot, deltas, finalBids, finalAsks } = buildChain(start, batches);
          const sync = new OrderBookSynchronizer(SYMBOL);
          const generation = sync.beginSync();

          // Buffered before the snapshot, shuffled, with duplicates mixed in —
          // exactly what a real socket does while the REST call is in flight.
          const delivery = [...deltas].reverse();
          for (const index of duplicateAt) {
            const duplicate = deltas[index % deltas.length];
            if (duplicate !== undefined) delivery.push(duplicate);
          }
          for (const delta of delivery) sync.applyDelta(delta);

          if (!sync.applySnapshot(snapshot, generation)) return false;
          expect(sync.book.toWire()).toEqual(authoritativeWire(finalBids, finalAsks));
          return sync.status === 'SYNCHRONIZED';
        },
      ),
      { numRuns: 150 },
    );
  });

  it('ignores deltas at or below the snapshot sequence', () => {
    fc.assert(
      fc.property(batchesArbitrary, fc.integer({ min: 1, max: 5_000 }), (batches, start) => {
        const { snapshot, deltas, finalBids, finalAsks } = buildChain(start, batches);
        const sync = new OrderBookSynchronizer(SYMBOL);
        const generation = sync.beginSync();

        // Stale deltas from before the snapshot must be discarded, not replayed.
        sync.applyDelta({
          type: 'book.delta',
          symbol: SYMBOL,
          previousSequence: String(start - 1),
          sequence: String(start),
          timestamp: 1,
          bids: [['1.0000', '9.00000000']],
          asks: [],
        });
        for (const delta of deltas) sync.applyDelta(delta);

        if (!sync.applySnapshot(snapshot, generation)) return false;
        expect(sync.book.toWire()).toEqual(authoritativeWire(finalBids, finalAsks));
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe('T4 — a gap always resynchronises', () => {
  it('never silently applies a delta across a hole', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(opArbitrary, { minLength: 1, maxLength: 3 }), {
          minLength: 3,
          maxLength: 25,
        }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 1, max: 24 }),
        (batches, start, dropSeed) => {
          const { snapshot, deltas } = buildChain(start, batches);
          const dropIndex = dropSeed % deltas.length;
          if (dropIndex === 0) return true;

          const sync = new OrderBookSynchronizer(SYMBOL);
          sync.applySnapshot(snapshot, sync.beginSync());

          for (let index = 0; index < dropIndex; index += 1) {
            const delta = deltas[index];
            if (delta !== undefined && sync.applyDelta(delta) !== 'applied') return false;
          }
          const sequenceBeforeGap = sync.sequence;

          const afterGap = deltas[dropIndex + 1];
          if (afterGap === undefined) return true;

          // The dropped delta is never delivered. The next one must be refused.
          if (sync.applyDelta(afterGap) !== 'resync-required') return false;
          if (statusOf(sync) !== 'RESYNCING') return false;
          // The local book is left exactly where it was, not half-patched.
          return sync.sequence === sequenceBeforeGap;
        },
      ),
      { numRuns: 150 },
    );
  });

  it('recovers cleanly from any gap with a fresh snapshot', () => {
    fc.assert(
      fc.property(batchesArbitrary, fc.integer({ min: 0, max: 5_000 }), (batches, start) => {
        const { snapshot, deltas, finalBids, finalAsks } = buildChain(start, batches);
        const sync = new OrderBookSynchronizer(SYMBOL);
        sync.applySnapshot(snapshot, sync.beginSync());

        // Force a gap immediately, then resync against the end state.
        sync.applyDelta({
          type: 'book.delta',
          symbol: SYMBOL,
          previousSequence: String(start + 999),
          sequence: String(start + 1_000),
          timestamp: 1,
          bids: [],
          asks: [],
        });
        if (sync.status !== 'RESYNCING') return false;

        const generation = sync.beginSync();
        const authoritative = authoritativeWire(finalBids, finalAsks);
        const ok = sync.applySnapshot(
          {
            symbol: SYMBOL,
            sequence: String(start + deltas.length),
            bids: authoritative.bids,
            asks: authoritative.asks,
          },
          generation,
        );
        if (!ok) return false;
        expect(sync.book.toWire()).toEqual(authoritative);
        return statusOf(sync) === 'SYNCHRONIZED';
      }),
      { numRuns: 100 },
    );
  });
});
