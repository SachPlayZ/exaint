import type { BookSnapshotResponse, HelloFrame, MarketSummary } from '@repo/protocol';
import { describe, expect, it } from 'vitest';
import { CandleHistoryController } from '../../features/market/chart/candle-history-controller.js';
import { MarketSelectionController } from '../../features/market/chart/market-selection-controller.js';
import { OrderBookRegistry } from '../../features/market/orderbook/synchronizer.js';
import { MarketSocketClient } from '../../features/market/socket/market-socket-client.js';
import {
  DeferredHistorySource,
  DeferredSnapshotSource,
  FakeChartSessionFactory,
  history,
  market,
  snapshot,
} from '../chart/helpers.js';
import { FakeSocket, FakeTimers, FakeVisibility, flush } from '../socket/fakes.js';

const hello = (marketSummary: MarketSummary, connectionId: string): HelloFrame => ({
  type: 'hello',
  protocolVersion: 'v1',
  connectionId,
  serverTime: 1_700_000_000_000,
  tier: 'degraded',
  symbols: [marketSummary],
});

const visibleSnapshot = (sequence: string): BookSnapshotResponse => ({
  symbol: 'BTC-USD',
  sequence,
  bids: [['100.0000', '1.00000000']],
  asks: [['101.0000', '1.00000000']],
});

function setup() {
  const timers = new FakeTimers(1_000);
  const visibility = new FakeVisibility();
  const sockets: FakeSocket[] = [];
  const tickets: string[] = [];
  const btc = market('BTC-USD');
  const client = new MarketSocketClient({
    wsUrl: 'ws://api.test/v1/ws',
    fetchTicket: async () => {
      const ticket = `ticket-${tickets.length + 1}`;
      tickets.push(ticket);
      return { ticket };
    },
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    timers,
    now: timers.now,
    random: () => 0.5,
    visibility,
  });
  const histories = new DeferredHistorySource();
  const snapshots = new DeferredSnapshotSource();
  const sessions = new FakeChartSessionFactory();
  const books = new OrderBookRegistry(() => {
    if (books.allSynchronized()) client.markSynchronized();
    else client.markSyncing();
  });
  const selection = new MarketSelectionController({
    socket: client,
    snapshots,
    books,
    history: new CandleHistoryController(histories, sessions),
  });
  const selections: Promise<'applied' | 'superseded'>[] = [];
  let initialHello = true;
  client.events.on('hello', () => {
    if (!initialHello) return;
    initialHello = false;
    selections.push(selection.selectMarket(btc, '1s'));
  });
  client.events.on('book.delta', (frame) => selection.onBookDelta(frame));
  client.events.on('resync', ({ reason }) => {
    if (reason !== 'backpressure') selections.push(selection.refreshSelected());
  });

  return {
    timers,
    visibility,
    sockets,
    tickets,
    btc,
    client,
    histories,
    snapshots,
    sessions,
    books,
    selection,
    selections,
  };
}

async function openInitial(context: ReturnType<typeof setup>): Promise<void> {
  context.client.connect();
  await flush();
  const socket = context.sockets[0];
  if (socket === undefined) throw new Error('initial socket missing');
  socket.open();
  socket.deliver(hello(context.btc, 'conn-1'));
  context.histories.requests[0]?.response.resolve(history('BTC-USD', '1s', []));
  context.snapshots.requests[0]?.response.resolve(visibleSnapshot('10'));
  await context.selections[0];
}

describe('P11 runtime recovery composition', () => {
  it('keeps the last known book visible and ages it during a network failure', async () => {
    const context = setup();
    await openInitial(context);
    const first = context.sockets[0];
    if (first === undefined) throw new Error('initial socket missing');
    const before = context.books.peek('BTC-USD')?.book.levels('bid', 1);

    context.timers.advance(4_200);
    first.serverClose(1006, 'network offline');

    expect(context.client.state).toBe('STALE');
    expect(context.client.ageMs()).toBe(4_200);
    expect(context.books.peek('BTC-USD')?.book.levels('bid', 1)).toEqual(before);
  });

  it('recovers a correct book after a backend restart with a fresh ticket', async () => {
    const context = setup();
    await openInitial(context);
    const first = context.sockets[0];
    if (first === undefined) throw new Error('initial socket missing');
    expect(context.client.state).toBe('LIVE');

    first.serverClose(1006, 'backend restart');
    expect(context.client.state).toBe('STALE');
    expect(context.books.peek('BTC-USD')?.sequence).toBe(10n);

    context.timers.advance(2_000);
    await flush();
    const second = context.sockets[1];
    if (second === undefined) throw new Error('reconnect socket missing');
    second.open();
    second.deliver(hello(context.btc, 'conn-2'));
    expect(second.framesOfType('subscribe')).toHaveLength(1);
    context.histories.requests[1]?.response.resolve(history('BTC-USD', '1s', []));
    context.snapshots.requests[1]?.response.resolve(snapshot('BTC-USD', '20'));
    await context.selections[1];

    second.deliver({
      type: 'book.delta',
      symbol: 'BTC-USD',
      previousSequence: '20',
      sequence: '21',
      timestamp: 1_700_000_000_000,
      bids: [],
      asks: [],
    });
    expect(context.tickets).toEqual(['ticket-1', 'ticket-2']);
    expect(context.client.state).toBe('LIVE');
    expect(context.books.peek('BTC-USD')?.sequence).toBe(21n);
    expect(context.client.subscriptions()).toHaveLength(1);
  });

  it('hard-refreshes only the selected symbol after a long hidden interval', async () => {
    const context = setup();
    await openInitial(context);

    context.visibility.setHidden(true);
    context.timers.advance(30_001);
    context.visibility.setHidden(false);
    expect(context.histories.requests).toHaveLength(2);
    expect(context.snapshots.requests).toHaveLength(2);

    context.histories.requests[1]?.response.resolve(history('BTC-USD', '1s', []));
    context.snapshots.requests[1]?.response.resolve(visibleSnapshot('30'));
    await context.selections[1];

    expect(context.sockets).toHaveLength(1);
    expect(context.client.subscriptions().map(({ symbol }) => symbol)).toEqual(['BTC-USD']);
    expect(context.books.symbols()).toEqual(['BTC-USD']);
    expect(context.books.peek('BTC-USD')?.sequence).toBe(30n);
  });

  it('leaks no socket timer, visibility listener, chart, or symbol after 50 switches', async () => {
    const context = setup();
    await openInitial(context);
    const symbols = ['ETH-USD', 'SOL-USD', 'HYPE-USD', 'ZEC-USD', 'BTC-USD'];

    for (let index = 0; index < 50; index += 1) {
      const symbol = symbols[index % symbols.length];
      if (symbol === undefined) throw new Error('test symbol missing');
      const requestIndex = index + 1;
      const selected = context.selection.selectMarket(market(symbol), '1s');
      context.histories.requests[requestIndex]?.response.resolve(history(symbol, '1s', []));
      context.snapshots.requests[requestIndex]?.response.resolve(
        snapshot(symbol, String(index + 20)),
      );
      await selected;
    }

    context.visibility.setHidden(true);
    context.timers.advance(5_000);
    context.visibility.setHidden(false);
    expect(context.sockets).toHaveLength(1);
    expect(context.client.subscriptions()).toHaveLength(1);
    expect(context.books.symbols()).toHaveLength(1);

    context.selection.dispose();
    context.client.disconnect();
    expect(context.timers.pending).toBe(0);
    expect(context.visibility.listenerCount).toBe(0);
    expect(context.client.subscriptions()).toHaveLength(0);
    expect(context.books.symbols()).toHaveLength(0);
    expect(context.sessions.created.every(({ session }) => session.disposeCalls === 1)).toBe(true);
    expect(context.sockets[0]?.closedWith).toMatchObject({ code: 1000 });
  });
});
