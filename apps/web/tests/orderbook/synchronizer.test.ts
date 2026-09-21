import { describe, expect, it } from 'vitest';
import type { BookDeltaFrame, BookSnapshotResponse } from '@repo/protocol';
import {
  OrderBookRegistry,
  OrderBookSynchronizer,
  type BookStatus,
} from '../../features/market/orderbook/synchronizer.js';

/** T2 — order-book synchronisation. I1, client side. */

function snapshot(
  sequence: number,
  options: { symbol?: string; bids?: [string, string][]; asks?: [string, string][] } = {},
): BookSnapshotResponse {
  return {
    symbol: options.symbol ?? 'BTC-USD',
    sequence: String(sequence),
    bids: options.bids ?? [['67231.1000', '0.30210000']],
    asks: options.asks ?? [['67231.5000', '0.20130000']],
  };
}

function delta(
  sequence: number,
  options: {
    symbol?: string;
    previousSequence?: number;
    bids?: [string, string][];
    asks?: [string, string][];
  } = {},
): BookDeltaFrame {
  return {
    type: 'book.delta',
    symbol: options.symbol ?? 'BTC-USD',
    previousSequence: String(options.previousSequence ?? sequence - 1),
    sequence: String(sequence),
    timestamp: 1_700_000_000_000 + sequence,
    bids: options.bids ?? [],
    asks: options.asks ?? [],
  };
}

describe('the documented worked example (docs/04-frontend.md §5)', () => {
  it('discards 99, applies 101–103, and lands at 103', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    expect(sync.status).toBe('SYNCING');

    for (const sequence of [98, 99, 101, 102, 103]) {
      expect(sync.applyDelta(delta(sequence))).toBe('buffered');
    }

    expect(sync.applySnapshot(snapshot(100), generation)).toBe(true);
    expect(sync.status).toBe('SYNCHRONIZED');
    expect(sync.sequence).toBe(103n);
    expect(sync.bufferedCount).toBe(0);
  });

  it('T2 exactly: buffer [99, 101, 102], snapshot 100, then a gap at 104', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    for (const sequence of [99, 101, 102]) sync.applyDelta(delta(sequence));

    expect(sync.applySnapshot(snapshot(100), generation)).toBe(true);
    expect(sync.sequence).toBe(102n);

    // previousSequence 104 against a local 102: the gap is immediate.
    expect(sync.applyDelta(delta(105, { previousSequence: 104 }))).toBe('resync-required');
    expect(sync.status).toBe('RESYNCING');
    // The book is still on screen, just no longer trusted.
    expect(sync.hasBook).toBe(true);
    expect(sync.sequence).toBe(102n);
  });
});

describe('edge cases worth the five minutes', () => {
  function synchronized(): OrderBookSynchronizer {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    sync.applySnapshot(snapshot(100), generation);
    return sync;
  }

  it('ignores a duplicate delta rather than resyncing on it', () => {
    const sync = synchronized();
    expect(sync.applyDelta(delta(101))).toBe('applied');
    expect(sync.applyDelta(delta(101))).toBe('ignored-duplicate');
    expect(sync.status).toBe('SYNCHRONIZED');
    expect(sync.sequence).toBe(101n);
  });

  it('reorders out-of-order arrivals inside the buffer', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    for (const sequence of [103, 101, 102]) sync.applyDelta(delta(sequence));
    expect(sync.applySnapshot(snapshot(100), generation)).toBe(true);
    expect(sync.sequence).toBe(103n);
  });

  it('resyncs when the buffer itself has a hole', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    for (const sequence of [101, 103]) sync.applyDelta(delta(sequence));
    expect(sync.applySnapshot(snapshot(100), generation)).toBe(false);
    expect(sync.status).toBe('RESYNCING');
  });

  it('treats quantity 0 as a delete', () => {
    const sync = synchronized();
    sync.applyDelta(delta(101, { bids: [['67230.9000', '0.50000000']] }));
    expect(sync.book.size('bid')).toBe(2);
    sync.applyDelta(delta(102, { bids: [['67230.9000', '0']] }));
    expect(sync.book.size('bid')).toBe(1);
    sync.applyDelta(delta(103, { asks: [['67231.5000', '0']] }));
    expect(sync.book.size('ask')).toBe(0);
  });

  it('accepts an empty snapshot without crashing or erroring', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    expect(sync.applySnapshot(snapshot(0, { bids: [], asks: [] }), generation)).toBe(true);
    expect(sync.status).toBe('SYNCHRONIZED');
    expect(sync.book.levels('bid')).toEqual([]);
    expect(sync.hasBook).toBe(false);
  });

  it('never merges a delta or snapshot for another symbol', () => {
    const sync = synchronized();
    expect(sync.applyDelta(delta(101, { symbol: 'ETH-USD' }))).toBe('ignored-symbol');
    expect(sync.sequence).toBe(100n);
    expect(sync.applySnapshot(snapshot(500, { symbol: 'ETH-USD' }), sync.generation)).toBe(false);
    expect(sync.sequence).toBe(100n);
  });

  it('drops a snapshot from a superseded attempt', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const stale = sync.beginSync();
    const current = sync.beginSync();
    expect(stale).not.toBe(current);

    expect(sync.applySnapshot(snapshot(999), stale)).toBe(false);
    expect(sync.sequence).toBeNull();
    expect(sync.applySnapshot(snapshot(100), current)).toBe(true);
    expect(sync.sequence).toBe(100n);
  });

  it('keeps the previous book visible through a resync, then replaces it', () => {
    const sync = synchronized();
    sync.applyDelta(delta(101, { bids: [['67230.9000', '0.50000000']] }));
    expect(sync.book.size('bid')).toBe(2);

    sync.applyDelta(delta(200, { previousSequence: 199 }));
    expect(sync.status).toBe('RESYNCING');
    expect(sync.book.size('bid')).toBe(2);

    const generation = sync.beginSync();
    expect(sync.status).toBe('RESYNCING');
    sync.applySnapshot(snapshot(200, { bids: [['67300.0000', '1.00000000']] }), generation);
    expect(sync.status).toBe('SYNCHRONIZED');
    expect(sync.book.levels('bid')).toHaveLength(1);
    expect(sync.sequence).toBe(200n);
  });

  it('computes cumulative depth from the touch outward', () => {
    const sync = new OrderBookSynchronizer('BTC-USD');
    const generation = sync.beginSync();
    sync.applySnapshot(
      snapshot(1, {
        bids: [
          ['100.0000', '1.00000000'],
          ['99.0000', '2.00000000'],
          ['98.0000', '3.00000000'],
        ],
        asks: [],
      }),
      generation,
    );
    expect(sync.book.levels('bid').map((level) => level.cumulative)).toEqual([
      100_000_000n,
      300_000_000n,
      600_000_000n,
    ]);
    expect(sync.book.bestBid()).toBe(1_000_000n);
  });
});

describe('per-symbol isolation', () => {
  it('a gap in one symbol leaves the others SYNCHRONIZED', () => {
    const statuses: [string, BookStatus][] = [];
    const registry = new OrderBookRegistry((status, symbol) => statuses.push([symbol, status]));

    for (const symbol of ['BTC-USD', 'ETH-USD', 'SOL-USD']) {
      const sync = registry.for(symbol);
      const generation = sync.beginSync();
      sync.applySnapshot(snapshot(100, { symbol }), generation);
    }
    expect(registry.allSynchronized()).toBe(true);

    expect(registry.route(delta(200, { symbol: 'ETH-USD', previousSequence: 199 }))).toBe(
      'resync-required',
    );

    expect(registry.peek('ETH-USD')?.status).toBe('RESYNCING');
    expect(registry.peek('BTC-USD')?.status).toBe('SYNCHRONIZED');
    expect(registry.peek('SOL-USD')?.status).toBe('SYNCHRONIZED');
    expect(registry.allSynchronized()).toBe(false);

    // And the other two keep applying normally through the resync.
    expect(registry.route(delta(101, { symbol: 'BTC-USD' }))).toBe('applied');
    expect(registry.peek('BTC-USD')?.sequence).toBe(101n);
    expect(statuses.filter(([symbol]) => symbol === 'BTC-USD').map(([, s]) => s)).toEqual([
      'SYNCING',
      'SYNCHRONIZED',
    ]);
  });

  it('ignores a delta for a symbol nothing is tracking', () => {
    const registry = new OrderBookRegistry();
    expect(registry.route(delta(1, { symbol: 'HYPE-USD' }))).toBe('ignored-symbol');
  });

  it('forgets a symbol entirely when it is removed', () => {
    const registry = new OrderBookRegistry();
    const sync = registry.for('BTC-USD');
    sync.applySnapshot(snapshot(100), sync.beginSync());
    registry.remove('BTC-USD');
    expect(registry.symbols()).toEqual([]);
    expect(sync.status).toBe('IDLE');
  });

  it('reports synchronization from the post-removal registry state', () => {
    const observations: boolean[] = [];
    const registry = new OrderBookRegistry(() => observations.push(registry.allSynchronized()));

    for (const symbol of ['BTC-USD', 'SOL-USD']) {
      const sync = registry.for(symbol);
      sync.applySnapshot(snapshot(100, { symbol }), sync.beginSync());
    }

    observations.length = 0;
    registry.remove('BTC-USD');

    expect(registry.symbols()).toEqual(['SOL-USD']);
    expect(observations).toEqual([true]);
  });
});
