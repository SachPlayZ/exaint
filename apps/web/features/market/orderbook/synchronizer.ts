import type { BookDeltaFrame, BookSnapshotResponse } from '@repo/protocol';
import { parseIdentifier } from '@repo/protocol';
import { LocalOrderBook } from './order-book-model';

/**
 * Client-side order-book synchronisation — I1 (docs/04-frontend.md §5,
 * docs/07-invariants.md#i1--order-book-continuity).
 *
 * **One instance per symbol.** Each owns its own buffer, sequence and status, so
 * a resync on `ETH-USD` cannot disturb `BTC-USD`.
 *
 * A delta is applied only when `delta.previousSequence === localSequence`.
 * Anything else means the local book is unknown, and the only honest recovery is
 * a fresh snapshot. No patching, no interpolation, no "it's probably fine".
 */
export type BookStatus = 'IDLE' | 'SYNCING' | 'SYNCHRONIZED' | 'RESYNCING';

export type DeltaOutcome =
  'buffered' | 'applied' | 'ignored-duplicate' | 'ignored-symbol' | 'resync-required';

/** Deltas held while the snapshot is in flight. Bounded so a stuck fetch cannot grow it forever. */
const MAX_BUFFERED_DELTAS = 2_000;

export class OrderBookSynchronizer {
  readonly symbol: string;
  readonly book = new LocalOrderBook();

  #status: BookStatus = 'IDLE';
  #sequence: bigint | null = null;
  #buffer: BookDeltaFrame[] = [];
  /** Bumped on every (re)sync so a late snapshot from a previous attempt is dropped. */
  #generation = 0;
  #onStatusChange: ((status: BookStatus, symbol: string) => void) | undefined;

  constructor(symbol: string, onStatusChange?: (status: BookStatus, symbol: string) => void) {
    this.symbol = symbol;
    this.#onStatusChange = onStatusChange;
  }

  get status(): BookStatus {
    return this.#status;
  }

  get sequence(): bigint | null {
    return this.#sequence;
  }

  get generation(): number {
    return this.#generation;
  }

  get bufferedCount(): number {
    return this.#buffer.length;
  }

  /** True once a snapshot has ever been merged — the UI keeps showing it during a resync. */
  get hasBook(): boolean {
    return this.book.size('bid') > 0 || this.book.size('ask') > 0;
  }

  /**
   * Step 3: start buffering, **before** the snapshot is requested. Reverse that
   * ordering and there is a window where deltas are lost with no gap signal.
   *
   * Returns the generation the caller must pass back with the snapshot.
   */
  beginSync(): number {
    this.#generation += 1;
    this.#buffer = [];
    this.#sequence = null;
    this.#setStatus(this.hasBook ? 'RESYNCING' : 'SYNCING');
    return this.#generation;
  }

  /** Steps 5–9. A snapshot from a superseded attempt is dropped, not merged. */
  applySnapshot(snapshot: BookSnapshotResponse, generation: number): boolean {
    if (snapshot.symbol !== this.symbol) return false;
    if (generation !== this.#generation) return false;

    const snapshotSequence = parseIdentifier(snapshot.sequence);
    this.book.applySnapshot(snapshot);
    this.#sequence = snapshotSequence;

    // Step 6: discard everything at or below the snapshot; step 7–8: apply the
    // contiguous chain that follows it.
    const pending = this.#buffer
      .filter((delta) => parseIdentifier(delta.sequence) > snapshotSequence)
      .sort((a, b) => (parseIdentifier(a.sequence) < parseIdentifier(b.sequence) ? -1 : 1));
    this.#buffer = [];

    for (const delta of pending) {
      // The same duplicate rule as the live path: a redelivered delta is
      // harmless and must not be mistaken for a hole.
      if (parseIdentifier(delta.sequence) <= this.#sequence) continue;
      if (parseIdentifier(delta.previousSequence) !== this.#sequence) {
        // The buffer itself has a hole. Honest recovery is another snapshot.
        this.#setStatus('RESYNCING');
        return false;
      }
      this.#applyDelta(delta);
    }

    this.#setStatus('SYNCHRONIZED');
    return true;
  }

  /**
   * Feeds one delta in. Buffers while syncing, applies when contiguous, and asks
   * for a resync on any gap.
   */
  applyDelta(delta: BookDeltaFrame): DeltaOutcome {
    if (delta.symbol !== this.symbol) return 'ignored-symbol';

    if (this.#status === 'SYNCING' || this.#status === 'RESYNCING' || this.#sequence === null) {
      if (this.#buffer.length >= MAX_BUFFERED_DELTAS) this.#buffer.shift();
      this.#buffer.push(delta);
      return 'buffered';
    }

    const previous = parseIdentifier(delta.previousSequence);
    if (previous === this.#sequence) {
      this.#applyDelta(delta);
      return 'applied';
    }

    // Already applied: a duplicate is harmless and must not trigger a resync.
    if (parseIdentifier(delta.sequence) <= this.#sequence) return 'ignored-duplicate';

    this.#setStatus('RESYNCING');
    return 'resync-required';
  }

  #applyDelta(delta: BookDeltaFrame): void {
    this.book.applyLevels(delta.bids, delta.asks);
    this.#sequence = parseIdentifier(delta.sequence);
  }

  /** Drops the book entirely — used when a symbol is unsubscribed. */
  reset(): void {
    this.book.reset();
    this.#buffer = [];
    this.#sequence = null;
    this.#generation += 1;
    this.#setStatus('IDLE');
  }

  #setStatus(status: BookStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    this.#onStatusChange?.(status, this.symbol);
  }
}

/**
 * The per-symbol registry. Nothing here is global: a gap in one symbol resyncs
 * one book and leaves every other `SYNCHRONIZED`.
 */
export class OrderBookRegistry {
  readonly #synchronizers = new Map<string, OrderBookSynchronizer>();
  readonly #onStatusChange: ((status: BookStatus, symbol: string) => void) | undefined;

  constructor(onStatusChange?: (status: BookStatus, symbol: string) => void) {
    this.#onStatusChange = onStatusChange;
  }

  for(symbol: string): OrderBookSynchronizer {
    const existing = this.#synchronizers.get(symbol);
    if (existing !== undefined) return existing;
    const created = new OrderBookSynchronizer(symbol, this.#onStatusChange);
    this.#synchronizers.set(symbol, created);
    return created;
  }

  peek(symbol: string): OrderBookSynchronizer | undefined {
    return this.#synchronizers.get(symbol);
  }

  symbols(): string[] {
    return [...this.#synchronizers.keys()];
  }

  /** Routes a delta to its own symbol's synchroniser and nowhere else. */
  route(delta: BookDeltaFrame): DeltaOutcome {
    const synchronizer = this.#synchronizers.get(delta.symbol);
    if (synchronizer === undefined) return 'ignored-symbol';
    return synchronizer.applyDelta(delta);
  }

  remove(symbol: string): void {
    const synchronizer = this.#synchronizers.get(symbol);
    if (synchronizer === undefined) return;

    // Remove first so the reset callback evaluates the registry that remains.
    // Resetting while the dead symbol is still tracked can push a completed
    // symbol switch back to SYNCING with no later transition to LIVE.
    this.#synchronizers.delete(symbol);
    synchronizer.reset();
  }

  /** True when every tracked symbol has a merged, contiguous book. */
  allSynchronized(): boolean {
    if (this.#synchronizers.size === 0) return false;
    return [...this.#synchronizers.values()].every((sync) => sync.status === 'SYNCHRONIZED');
  }
}
