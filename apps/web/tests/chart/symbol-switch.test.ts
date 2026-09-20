import type { Channel, Interval } from '@repo/protocol';
import { describe, expect, it } from 'vitest';
import { CandleHistoryController } from '../../features/market/chart/candle-history-controller.js';
import {
  MarketSelectionController,
  type SelectionSocket,
} from '../../features/market/chart/market-selection-controller.js';
import { OrderBookRegistry } from '../../features/market/orderbook/synchronizer.js';
import {
  candle,
  DeferredHistorySource,
  DeferredSnapshotSource,
  FakeChartSessionFactory,
  history,
  market,
  snapshot,
} from './helpers.js';

class FakeSelectionSocket implements SelectionSocket {
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

describe('T6 symbol switch race', () => {
  it('rejects late SOL data, subscribes HYPE first, and leaves one subscription', async () => {
    const socket = new FakeSelectionSocket();
    const snapshots = new DeferredSnapshotSource();
    const historySource = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const books = new OrderBookRegistry();
    const historyController = new CandleHistoryController(historySource, sessions);
    const selection = new MarketSelectionController({
      socket,
      snapshots,
      books,
      history: historyController,
    });

    const solSwitch = selection.selectMarket(market('SOL-USD', '0.0010'), '1s');
    const hypeSwitch = selection.selectMarket(market('HYPE-USD', '0.0010'), '1s');

    const hypeCandle = candle('HYPE-USD', 1_700_000_000_000, '1');
    historySource.requests[1]?.response.resolve(history('HYPE-USD', '1s', [hypeCandle]));
    snapshots.requests[1]?.response.resolve(snapshot('HYPE-USD'));
    await expect(hypeSwitch).resolves.toBe('applied');

    historySource.requests[0]?.response.resolve(
      history('SOL-USD', '1s', [candle('SOL-USD', 1_700_000_000_000, '1')]),
    );
    snapshots.requests[0]?.response.resolve(snapshot('SOL-USD'));
    await expect(solSwitch).resolves.toBe('superseded');

    expect(selection.selectedSymbol).toBe('HYPE-USD');
    expect(sessions.created).toHaveLength(1);
    expect(sessions.created[0]?.scope.symbol).toBe('HYPE-USD');
    expect(sessions.created[0]?.session.setDataCalls).toEqual([[hypeCandle]]);
    expect(books.peek('HYPE-USD')?.status).toBe('SYNCHRONIZED');
    expect(books.peek('SOL-USD')).toBeUndefined();
    expect(socket.subscriptions()).toEqual([{ symbol: 'HYPE-USD' }]);
    expect(socket.operations.indexOf('subscribe:HYPE-USD:1s')).toBeLessThan(
      socket.operations.indexOf('unsubscribe:SOL-USD'),
    );
  });

  it('removes the old subscription after history wins even when the new snapshot fails', async () => {
    const socket = new FakeSelectionSocket();
    const snapshots = new DeferredSnapshotSource();
    const historySource = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const books = new OrderBookRegistry();
    const selection = new MarketSelectionController({
      socket,
      snapshots,
      books,
      history: new CandleHistoryController(historySource, sessions),
    });

    const solSwitch = selection.selectMarket(market('SOL-USD'), '1s');
    historySource.requests[0]?.response.resolve(history('SOL-USD', '1s', []));
    snapshots.requests[0]?.response.resolve(snapshot('SOL-USD'));
    await solSwitch;

    const hypeSwitch = selection.selectMarket(market('HYPE-USD'), '1s');
    historySource.requests[1]?.response.resolve(history('HYPE-USD', '1s', []));
    snapshots.requests[1]?.response.reject(new Error('snapshot unavailable'));
    await expect(hypeSwitch).rejects.toThrow('snapshot unavailable');

    expect(socket.subscriptions()).toEqual([{ symbol: 'HYPE-USD' }]);
    expect(books.peek('SOL-USD')).toBeUndefined();
    expect(sessions.created[1]?.scope.symbol).toBe('HYPE-USD');
  });
});
