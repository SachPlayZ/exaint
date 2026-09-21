'use client';

import type { Interval, MarketSummary, Tier } from '@repo/protocol';
import { parsePrice, TIER_CADENCE_MS } from '@repo/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { MarketRestClient } from '../api/rest-client';
import { MarketChartPipeline } from '../chart/market-chart-pipeline';
import type { ChartHoverValue } from '../chart/candlestick-chart-adapter';
import { MarketUiModel, type MarketUiSnapshot } from '../model/market-ui-model';
import { RafPublisher, type AnimationFrameScheduler } from '../model/raf-publisher';
import { RollingRate } from '../model/rolling-rate';
import { BrowserWebSocket } from '../socket/browser-websocket';
import { MarketSocketClient } from '../socket/market-socket-client';
import { useConnectionStore } from '../stores/connection-store';
import type { BookStatus } from '../orderbook/synchronizer';

const browserFrames: AnimationFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export const DEFAULT_CHART_INTERVAL: Interval = '5s';

export interface TerminalRuntimeSnapshot extends MarketUiSnapshot {
  readonly market: MarketSummary;
  readonly interval: Interval;
  readonly latestPriceFixed: bigint | null;
  readonly sessionChangeBps: bigint | null;
  readonly bookStatus: BookStatus;
  readonly lastBookSequence: string | null;
  readonly candleActualHz: number;
  readonly tradeActualHz: number;
  readonly waitingForCandles: boolean;
  readonly lastLiveAgeMs: number | null;
}

function sessionChangeBps(latest: string | null, baseline: string | null): bigint | null {
  if (latest === null || baseline === null) return null;
  const latestPrice = parsePrice(latest);
  const baselinePrice = parsePrice(baseline);
  if (baselinePrice === 0n) return null;
  return ((latestPrice - baselinePrice) * 10_000n) / baselinePrice;
}

export class TerminalRuntime {
  readonly socket: MarketSocketClient;
  readonly pipeline: MarketChartPipeline;
  readonly #model: MarketUiModel;
  readonly #publisher: RafPublisher<TerminalRuntimeSnapshot>;
  readonly #candleRate: RollingRate;
  readonly #tradeRate: RollingRate;
  readonly #markets: ReadonlyMap<string, MarketSummary>;
  readonly #listeners = new Set<() => void>();
  readonly #unsubscribeSocket: readonly (() => void)[];
  readonly #rateTimer: number;

  #market: MarketSummary;
  #interval: Interval = DEFAULT_CHART_INTERVAL;
  #snapshot: TerminalRuntimeSnapshot;
  #hasCandle = false;
  #helloReceived = false;
  #disposed = false;

  constructor(options: {
    readonly markets: readonly MarketSummary[];
    readonly initialMarket: MarketSummary;
    readonly container: HTMLElement;
    readonly queryClient: QueryClient;
    readonly restClient: MarketRestClient;
    readonly wsUrl: string;
    readonly onHoverChange?: (value: ChartHoverValue | null) => void;
    readonly now?: () => number;
    readonly frames?: AnimationFrameScheduler;
  }) {
    const now = options.now ?? (() => performance.now());
    this.#market = options.initialMarket;
    this.#markets = new Map(options.markets.map((market) => [market.symbol, market]));
    this.#model = new MarketUiModel(options.initialMarket.symbol);
    this.#candleRate = new RollingRate(now);
    this.#tradeRate = new RollingRate(now);
    this.socket = new MarketSocketClient({
      wsUrl: options.wsUrl,
      fetchTicket: (signal) => options.restClient.fetchTicket(signal),
      createSocket: (url) => new BrowserWebSocket(url),
      now,
    });
    this.pipeline = new MarketChartPipeline({
      container: options.container,
      queryClient: options.queryClient,
      restClient: options.restClient,
      socket: this.socket,
      ...(options.onHoverChange === undefined ? {} : { onHoverChange: options.onHoverChange }),
    });
    this.#snapshot = this.#createSnapshot();
    this.#publisher = new RafPublisher({
      createSnapshot: () => this.#createSnapshot(),
      publish: (snapshot) => {
        this.#snapshot = snapshot;
        for (const listener of [...this.#listeners]) listener();
      },
      scheduler: options.frames ?? browserFrames,
    });
    this.#unsubscribeSocket = this.#wireSocket();
    this.#rateTimer = window.setInterval(() => this.#publisher.markDirty(), 1_000);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): TerminalRuntimeSnapshot => this.#snapshot;

  start(): void {
    if (this.#disposed) return;
    this.socket.connect();
  }

  selectMarket(market: MarketSummary): void {
    if (this.#disposed || !this.#markets.has(market.symbol)) return;
    this.#market = market;
    this.#model.selectSymbol(market.symbol);
    this.#hasCandle = false;
    this.#publisher.markDirty();
    if (this.#helloReceived) {
      this.#trackSelection(this.pipeline.selectMarket(market, this.#interval));
    }
  }

  selectInterval(interval: Interval): void {
    if (this.#disposed || interval === this.#interval) return;
    this.#interval = interval;
    this.#hasCandle = false;
    this.#publisher.markDirty();
    if (this.#helloReceived) {
      this.#trackSelection(this.pipeline.selectInterval(interval));
    }
  }

  setTierOverride(tier: Tier | null): void {
    this.socket.setTierOverride(tier);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribeSocket) unsubscribe();
    this.#listeners.clear();
    window.clearInterval(this.#rateTimer);
    this.#publisher.dispose();
    this.pipeline.dispose();
    this.socket.disconnect();
  }

  #wireSocket(): readonly (() => void)[] {
    const store = useConnectionStore.getState();
    return [
      this.socket.events.on('state', ({ state }) => {
        store.setConnection(state);
        this.#publisher.markDirty();
      }),
      this.socket.events.on('hello', (frame) => {
        const initialHello = !this.#helloReceived;
        this.#helloReceived = true;
        store.setConnectionId(frame.connectionId);
        store.setTier({
          autoTier: frame.tier,
          tierOverride: null,
          effectiveTier: frame.tier,
          ...TIER_CADENCE_MS[frame.tier],
        });
        if (initialHello) {
          this.#trackSelection(this.pipeline.selectMarket(this.#market, this.#interval));
        }
      }),
      this.socket.events.on('latency', ({ rttMs, jitterMs }) => {
        store.setLatency(rttMs, jitterMs);
      }),
      this.socket.events.on('tier.changed', (frame) => {
        store.setTier({
          autoTier: frame.autoTier,
          tierOverride: frame.override,
          effectiveTier: frame.effectiveTier,
          candlesUpdateMs: frame.candlesUpdateMs,
          tradesBatchMs: frame.tradesBatchMs,
        });
      }),
      this.socket.events.on('trades.batch', (frame) => {
        if (frame.symbol !== this.#market.symbol) return;
        this.#tradeRate.record();
        this.#publisher.mutate(() => this.#model.processTrades(frame.trades));
      }),
      this.socket.events.on('candles.update', (frame) => {
        if (frame.symbol !== this.#market.symbol || frame.interval !== this.#interval) return;
        this.#hasCandle ||= frame.candles.length > 0;
        this.#candleRate.record();
        this.#publisher.markDirty();
      }),
      this.socket.events.on('book.delta', (frame) => {
        if (frame.symbol === this.#market.symbol) this.#publisher.markDirty();
      }),
      this.socket.events.on('visibility', ({ hidden }) => {
        this.pipeline.setRenderingPaused(hidden);
        this.#publisher.setPaused(hidden);
      }),
      this.socket.events.on('resync', ({ reason }) => {
        if (reason === 'backpressure') return;
        this.#hasCandle = false;
        this.#publisher.markDirty();
        this.#trackSelection(this.pipeline.refreshSelected());
      }),
      this.pipeline.subscribeBookChange(() => this.#publisher.markDirty()),
    ];
  }

  #createSnapshot(): TerminalRuntimeSnapshot {
    const synchronizer = this.pipeline.books.peek(this.#market.symbol);
    const market = this.#model.snapshot({
      bids: synchronizer?.book.levels('bid', 25) ?? [],
      asks: synchronizer?.book.levels('ask', 25) ?? [],
    });
    return Object.freeze({
      ...market,
      market: this.#market,
      interval: this.#interval,
      latestPriceFixed: market.latestPrice === null ? null : parsePrice(market.latestPrice),
      sessionChangeBps: sessionChangeBps(market.latestPrice, market.sessionBaselinePrice),
      bookStatus: synchronizer?.status ?? 'IDLE',
      lastBookSequence: synchronizer?.sequence?.toString() ?? null,
      candleActualHz: this.#candleRate.hertz(),
      tradeActualHz: this.#tradeRate.hertz(),
      waitingForCandles: !this.#hasCandle,
      lastLiveAgeMs: this.socket.ageMs(),
    });
  }

  #trackSelection(selection: Promise<'applied' | 'superseded'>): void {
    void selection.then(
      (result) => {
        if (result === 'applied') this.#hasCandle = this.pipeline.hasCandles;
        this.#publisher.markDirty();
      },
      () => this.#publisher.markDirty(),
    );
  }
}
