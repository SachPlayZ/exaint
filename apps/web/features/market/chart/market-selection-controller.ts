import type {
  BookDeltaFrame,
  BookSnapshotResponse,
  CandlesUpdateFrame,
  Channel,
  Interval,
  MarketSummary,
} from '@repo/protocol';
import type { CandleHistoryController, HistorySelectionResult } from './candle-history-controller';
import type { OrderBookRegistry } from '../orderbook/synchronizer';

const MARKET_CHANNELS: readonly Channel[] = ['book', 'trades', 'candles'];

export interface SelectionSocket {
  subscribe(symbol: string, channels: readonly Channel[], interval: Interval | null): void;
  unsubscribe(symbol: string): void;
  setInterval(symbol: string, interval: Interval): void;
  subscriptions(): readonly { readonly symbol: string }[];
}

export interface SnapshotSource {
  fetchBookSnapshot(symbol: string, signal: AbortSignal): Promise<BookSnapshotResponse>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Coordinates symbol/interval selection without React. Every late-result guard
 * is explicit: request abort, response tags, and one shared generation id.
 */
export class MarketSelectionController {
  readonly #socket: SelectionSocket;
  readonly #snapshots: SnapshotSource;
  readonly #books: OrderBookRegistry;
  readonly #history: CandleHistoryController;

  #market: MarketSummary | null = null;
  #interval: Interval | null = null;
  #generation = 0;
  #snapshotAbort: AbortController | null = null;

  constructor(options: {
    readonly socket: SelectionSocket;
    readonly snapshots: SnapshotSource;
    readonly books: OrderBookRegistry;
    readonly history: CandleHistoryController;
  }) {
    this.#socket = options.socket;
    this.#snapshots = options.snapshots;
    this.#books = options.books;
    this.#history = options.history;
  }

  get selectedSymbol(): string | null {
    return this.#market?.symbol ?? null;
  }

  get selectedInterval(): Interval | null {
    return this.#interval;
  }

  get hasCandles(): boolean {
    return this.#history.hasCandles;
  }

  async selectMarket(market: MarketSummary, interval: Interval): Promise<HistorySelectionResult> {
    if (this.#market?.symbol === market.symbol) return this.selectInterval(interval);

    const generation = ++this.#generation;
    this.#market = market;
    this.#interval = interval;

    // Subscribe B before any path can unsubscribe A (docs/04 §6).
    this.#socket.subscribe(market.symbol, MARKET_CHANNELS, interval);
    const synchronizer = this.#books.for(market.symbol);
    const bookGeneration = synchronizer.beginSync();

    this.#snapshotAbort?.abort();
    const snapshotAbort = new AbortController();
    this.#snapshotAbort = snapshotAbort;
    const snapshotResult = this.#snapshots
      .fetchBookSnapshot(market.symbol, snapshotAbort.signal)
      .then((snapshot) => {
        if (generation !== this.#generation || snapshot.symbol !== market.symbol) return false;
        return synchronizer.applySnapshot(snapshot, bookGeneration);
      })
      .then(
        (applied) => ({ ok: true as const, applied }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    const historyRequest = this.#history.select({
      symbol: market.symbol,
      interval,
      tickSize: market.tickSize,
    });
    const historyResult = await historyRequest;
    if (generation !== this.#generation || historyResult !== 'applied') return 'superseded';
    this.#removeInactiveSubscriptions(market.symbol);

    const snapshot = await snapshotResult;
    if (!snapshot.ok) {
      if (generation !== this.#generation || isAbortError(snapshot.error)) return 'superseded';
      throw snapshot.error;
    }
    if (!snapshot.applied) return 'superseded';
    return 'applied';
  }

  async selectInterval(interval: Interval): Promise<HistorySelectionResult> {
    const market = this.#market;
    if (market === null) return 'superseded';
    this.#interval = interval;
    this.#socket.setInterval(market.symbol, interval);
    const result = await this.#history.select({
      symbol: market.symbol,
      interval,
      tickSize: market.tickSize,
    });
    if (result === 'applied' && this.#market?.symbol === market.symbol) {
      this.#removeInactiveSubscriptions(market.symbol);
    }
    return result;
  }

  onCandles(frame: CandlesUpdateFrame): void {
    if (frame.symbol !== this.#market?.symbol || frame.interval !== this.#interval) return;
    this.#history.onCandles(frame);
  }

  onBookDelta(delta: BookDeltaFrame): void {
    if (delta.symbol !== this.#market?.symbol) return;
    this.#books.route(delta);
  }

  dispose(): void {
    this.#generation += 1;
    this.#snapshotAbort?.abort();
    this.#snapshotAbort = null;
    this.#history.dispose();
    for (const subscription of this.#socket.subscriptions()) {
      this.#socket.unsubscribe(subscription.symbol);
      this.#books.remove(subscription.symbol);
    }
    this.#market = null;
    this.#interval = null;
  }

  #removeInactiveSubscriptions(selectedSymbol: string): void {
    for (const subscription of this.#socket.subscriptions()) {
      if (subscription.symbol === selectedSymbol) continue;
      this.#socket.unsubscribe(subscription.symbol);
      this.#books.remove(subscription.symbol);
    }
  }
}
