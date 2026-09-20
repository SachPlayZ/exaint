'use client';

import type { Interval, MarketSummary } from '@repo/protocol';
import type { QueryClient } from '@tanstack/react-query';
import type { MarketRestClient } from '../api/rest-client';
import { OrderBookRegistry } from '../orderbook/synchronizer';
import type { MarketSocketClient } from '../socket/market-socket-client';
import {
  CandleHistoryController,
  type ChartSessionFactory,
  type HistorySelectionResult,
} from './candle-history-controller';
import { CandlestickChartAdapter, type ChartHoverValue } from './candlestick-chart-adapter';
import { MarketSelectionController } from './market-selection-controller';
import { QueryCandleHistorySource } from './query-history-source';

/** Production composition root for the P9 chart path. Mounted by the P10 terminal. */
export class MarketChartPipeline {
  readonly books: OrderBookRegistry;
  readonly selection: MarketSelectionController;
  readonly #unsubscribe: readonly (() => void)[];

  constructor(options: {
    readonly container: HTMLElement;
    readonly queryClient: QueryClient;
    readonly restClient: MarketRestClient;
    readonly socket: MarketSocketClient;
    readonly onHoverChange?: (value: ChartHoverValue | null) => void;
  }) {
    this.books = new OrderBookRegistry(() => {
      if (this.books.allSynchronized()) options.socket.markSynchronized();
      else options.socket.markSyncing();
    });
    const sessions: ChartSessionFactory = {
      create: (scope) =>
        new CandlestickChartAdapter(options.container, scope.tickSize, {
          ...(options.onHoverChange === undefined ? {} : { onHoverChange: options.onHoverChange }),
        }),
    };
    const history = new CandleHistoryController(
      new QueryCandleHistorySource(options.queryClient, options.restClient),
      sessions,
    );
    this.selection = new MarketSelectionController({
      socket: options.socket,
      snapshots: options.restClient,
      books: this.books,
      history,
    });
    this.#unsubscribe = [
      options.socket.events.on('candles.update', (frame) => this.selection.onCandles(frame)),
      options.socket.events.on('book.delta', (frame) => this.selection.onBookDelta(frame)),
    ];
  }

  selectMarket(market: MarketSummary, interval: Interval): Promise<HistorySelectionResult> {
    return this.selection.selectMarket(market, interval);
  }

  selectInterval(interval: Interval): Promise<HistorySelectionResult> {
    return this.selection.selectInterval(interval);
  }

  get hasCandles(): boolean {
    return this.selection.hasCandles;
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.selection.dispose();
  }
}
