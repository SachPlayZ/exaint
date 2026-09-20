import { describe, expect, it } from 'vitest';
import {
  moveWatchlistItem,
  readWatchlistOrder,
  reconcileWatchlistOrder,
  type WatchlistOrderStorage,
  writeWatchlistOrder,
} from '../../features/market/watchlist/order.js';

const registry = ['ALPHA-USD', 'BETA-USD', 'GAMMA-USD'];
const storageKey = 'watchlist-order';

class MemoryStorage implements WatchlistOrderStorage {
  readonly #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

describe('watchlist order reconciliation', () => {
  it('drops unknown values and duplicates, then appends new registry symbols', () => {
    expect(
      reconcileWatchlistOrder(
        ['BETA-USD', 'UNKNOWN-USD', 'BETA-USD', 42, null, 'ALPHA-USD'],
        registry,
      ),
    ).toEqual(['BETA-USD', 'ALPHA-USD', 'GAMMA-USD']);
  });

  it('uses registry order when persisted JSON is corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem(storageKey, '{not-json');

    expect(readWatchlistOrder(storage, storageKey, registry)).toEqual(registry);
  });

  it('uses registry order when storage is unavailable or throws', () => {
    const throwingStorage: WatchlistOrderStorage = {
      getItem: () => {
        throw new Error('storage denied');
      },
      setItem: () => {
        throw new Error('storage denied');
      },
    };

    expect(readWatchlistOrder(undefined, storageKey, registry)).toEqual(registry);
    expect(readWatchlistOrder(throwingStorage, storageKey, registry)).toEqual(registry);
    expect(writeWatchlistOrder(throwingStorage, storageKey, registry)).toBe(false);
  });

  it('persists and restores the user order', () => {
    const storage = new MemoryStorage();
    const userOrder = ['GAMMA-USD', 'ALPHA-USD', 'BETA-USD'];

    expect(writeWatchlistOrder(storage, storageKey, userOrder)).toBe(true);
    expect(readWatchlistOrder(storage, storageKey, registry)).toEqual(userOrder);
  });
});

describe('watchlist item movement', () => {
  it('moves immutably without accepting or changing selection state', () => {
    const order = ['ALPHA-USD', 'BETA-USD', 'GAMMA-USD'];

    expect(moveWatchlistItem(order, 0, 2)).toEqual(['BETA-USD', 'GAMMA-USD', 'ALPHA-USD']);
    expect(order).toEqual(['ALPHA-USD', 'BETA-USD', 'GAMMA-USD']);
    expect(moveWatchlistItem.length).toBe(3);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [registry.length, 0],
    [0, registry.length],
    [0.5, 1],
    [0, 1.5],
  ])('leaves the order unchanged for out-of-bounds move %s -> %s', (fromIndex, toIndex) => {
    const result = moveWatchlistItem(registry, fromIndex, toIndex);

    expect(result).toEqual(registry);
    expect(result).not.toBe(registry);
  });
});
