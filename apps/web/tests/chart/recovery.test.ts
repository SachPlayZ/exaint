import type { BookDeltaFrame, BookSnapshotResponse, Channel, Interval } from '@repo/protocol';
import { describe, expect, it } from 'vitest';
import { CandleHistoryController } from '../../features/market/chart/candle-history-controller.js';
import {
  MarketSelectionController,
  type SelectionSocket,
} from '../../features/market/chart/market-selection-controller.js';
import { OrderBookRegistry } from '../../features/market/orderbook/synchronizer.js';
import {
  DeferredHistorySource,
  DeferredSnapshotSource,
  FakeChartSessionFactory,
  history,
  market,
} from './helpers.js';
import { flush } from '../socket/fakes.js';

class RecoverySocket implements SelectionSocket {
  readonly operations: string[] = [];
  readonly #subscriptions = new Map<string, { readonly symbol: string }>();

  subscribe(symbol: string, _channels: readonly Channel[], interval: Interval | null): void {
    this.operations.push(`subscribe:${symbol}:${interval}`);
    this.#subscriptions.set(symbol, { symbol });
  }

  unsubscribe(symbol: string): void {
    this.operations.push(`unsubscribe:${symbol}`);
    this.#subscriptions.delete(symbol);
  }

  setInterval(symbol: string, interval: Interval): void {
    this.operations.push(`interval:${symbol}:${interval}`);
  }

  subscriptions(): readonly { readonly symbol: string }[] {
    return [...this.#subscriptions.values()];
  }
}

function bookSnapshot(symbol: string, sequence: string): BookSnapshotResponse {
  return {
    symbol,
    sequence,
    bids: [['100.0000', '1.00000000']],
    asks: [['101.0000', '1.00000000']],
  };
}

function delta(previousSequence: string, sequence: string): BookDeltaFrame {
  return {
    type: 'book.delta',
    symbol: 'BTC-USD',
    previousSequence,
    sequence,
    timestamp: 1_700_000_000_000,
    bids: [['100.0000', '2.00000000']],
    asks: [],
  };
}

function setup() {
  const socket = new RecoverySocket();
  const snapshots = new DeferredSnapshotSource();
  const histories = new DeferredHistorySource();
  const sessions = new FakeChartSessionFactory();
  const books = new OrderBookRegistry();
  const selection = new MarketSelectionController({
    socket,
    snapshots,
    books,
    history: new CandleHistoryController(histories, sessions),
  });
  return { socket, snapshots, histories, sessions, books, selection };
}

async function resolveSelection(
  context: ReturnType<typeof setup>,
  symbol: string,
  requestIndex: number,
  sequence = '10',
): Promise<void> {
  context.histories.requests[requestIndex]?.response.resolve(history(symbol, '1s', []));
  context.snapshots.requests[requestIndex]?.response.resolve(bookSnapshot(symbol, sequence));
  await Promise.resolve();
}

describe('P11 recovery', () => {
  it('detects a missing book event and rebuilds only the selected symbol', async () => {
    const context = setup();
    const selected = context.selection.selectMarket(market('BTC-USD'), '1s');
    await resolveSelection(context, 'BTC-USD', 0);
    await selected;

    context.selection.onBookDelta(delta('10', '11'));
    context.selection.onBookDelta(delta('12', '13'));
    const book = context.books.peek('BTC-USD');
    expect(book?.status).toBe('RESYNCING');
    expect(book?.book.levels('bid', 1)[0]?.price).toBe(1_000_000n);
    expect(context.snapshots.requests).toHaveLength(2);

    context.selection.onBookDelta(delta('13', '14'));
    context.snapshots.requests[1]?.response.resolve(bookSnapshot('BTC-USD', '13'));
    await Promise.resolve();
    await Promise.resolve();

    expect(book?.status).toBe('SYNCHRONIZED');
    expect(book?.sequence).toBe(14n);
    expect(context.socket.subscriptions()).toEqual([{ symbol: 'BTC-USD' }]);
  });

  it('hard-refreshes current history and book without adding a subscription', async () => {
    const context = setup();
    const selected = context.selection.selectMarket(market('BTC-USD'), '1s');
    await resolveSelection(context, 'BTC-USD', 0);
    await selected;
    const operationCount = context.socket.operations.length;

    const refreshed = context.selection.refreshSelected();
    await resolveSelection(context, 'BTC-USD', 1, '20');
    await expect(refreshed).resolves.toBe('applied');

    expect(context.socket.operations).toHaveLength(operationCount);
    expect(context.socket.subscriptions()).toEqual([{ symbol: 'BTC-USD' }]);
    expect(context.books.peek('BTC-USD')?.sequence).toBe(20n);
    expect(context.sessions.created[0]?.session.disposeCalls).toBe(1);
  });

  it('requests another snapshot when the buffered recovery chain also has a hole', async () => {
    const context = setup();
    const selected = context.selection.selectMarket(market('BTC-USD'), '1s');
    await resolveSelection(context, 'BTC-USD', 0);
    await selected;

    context.selection.onBookDelta(delta('12', '13'));
    context.selection.onBookDelta(delta('14', '15'));
    context.snapshots.requests[1]?.response.resolve(bookSnapshot('BTC-USD', '13'));
    await flush(8);
    expect(context.snapshots.requests).toHaveLength(3);

    context.snapshots.requests[2]?.response.resolve(bookSnapshot('BTC-USD', '15'));
    await flush(8);
    expect(context.books.peek('BTC-USD')?.status).toBe('SYNCHRONIZED');
    expect(context.books.peek('BTC-USD')?.sequence).toBe(15n);
  });

  it('releases every superseded resource after 50 symbol switches and disposal', async () => {
    const context = setup();
    const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'HYPE-USD', 'ZEC-USD'];

    for (let index = 0; index < 50; index += 1) {
      const symbol = symbols[index % symbols.length];
      if (symbol === undefined) throw new Error('missing test symbol');
      const selected = context.selection.selectMarket(market(symbol), '1s');
      await resolveSelection(context, symbol, index, String(index + 1));
      await selected;
      expect(context.socket.subscriptions()).toEqual([{ symbol }]);
      expect(context.books.symbols()).toEqual([symbol]);
    }

    context.selection.dispose();
    expect(context.socket.subscriptions()).toEqual([]);
    expect(context.books.symbols()).toEqual([]);
    expect(context.sessions.created).toHaveLength(50);
    expect(context.sessions.created.every(({ session }) => session.disposeCalls === 1)).toBe(true);
    expect(context.snapshots.requests.every(({ signal }) => signal.aborted)).toBe(true);
  });
});
