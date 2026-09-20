export interface WatchlistOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Keeps the user's valid order while treating the server registry as authoritative
 * for which symbols exist.
 */
export function reconcileWatchlistOrder(
  storedOrder: unknown,
  registrySymbols: readonly string[],
): string[] {
  const knownSymbols = new Set(registrySymbols);
  const seen = new Set<string>();
  const order: string[] = [];

  if (Array.isArray(storedOrder)) {
    for (const candidate of storedOrder) {
      if (typeof candidate !== 'string' || !knownSymbols.has(candidate) || seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      order.push(candidate);
    }
  }

  for (const symbol of registrySymbols) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    order.push(symbol);
  }

  return order;
}

export function readWatchlistOrder(
  storage: WatchlistOrderStorage | null | undefined,
  key: string,
  registrySymbols: readonly string[],
): string[] {
  const fallback = (): string[] => reconcileWatchlistOrder(undefined, registrySymbols);

  if (storage == null) return fallback();

  try {
    const stored = storage.getItem(key);
    if (stored === null) return fallback();

    const parsed: unknown = JSON.parse(stored);
    return reconcileWatchlistOrder(parsed, registrySymbols);
  } catch {
    return fallback();
  }
}

export function writeWatchlistOrder(
  storage: WatchlistOrderStorage | null | undefined,
  key: string,
  order: readonly string[],
): boolean {
  if (storage == null) return false;

  try {
    storage.setItem(key, JSON.stringify(order));
    return true;
  } catch {
    return false;
  }
}

/** Reorders only the list; selecting a market remains a separate UI action. */
export function moveWatchlistItem(
  order: readonly string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  const moved = [...order];

  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= moved.length ||
    toIndex >= moved.length ||
    fromIndex === toIndex
  ) {
    return moved;
  }

  const item = moved[fromIndex];
  if (item === undefined) return moved;

  moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, item);
  return moved;
}
