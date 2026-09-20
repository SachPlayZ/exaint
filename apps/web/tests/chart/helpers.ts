import type {
  BookSnapshotResponse,
  Candle,
  CandleHistoryResponse,
  Interval,
  MarketSummary,
} from '@repo/protocol';
import type {
  CandleHistorySource,
  ChartSessionFactory,
} from '../../features/market/chart/candle-history-controller.js';
import type { CandleScope } from '../../features/market/chart/candle-data.js';
import type { ChartSession } from '../../features/market/chart/candlestick-chart-adapter.js';
import type { SnapshotSource } from '../../features/market/chart/market-selection-controller.js';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (error) => rejectPromise?.(error),
  };
}

export function candle(
  symbol: string,
  startTime: number,
  lastTradeId: string,
  overrides: Partial<Candle> = {},
): Candle {
  return {
    symbol,
    startTime,
    open: '100.0000',
    high: '102.0000',
    low: '99.0000',
    close: '101.0000',
    volume: '1.00000000',
    tradeCount: 1,
    lastTradeId,
    final: false,
    ...overrides,
  };
}

export function history(
  symbol: string,
  interval: Interval,
  candles: readonly Candle[],
): CandleHistoryResponse {
  return { symbol, interval, serverTime: 1_700_000_000_000, candles: [...candles] };
}

export function market(symbol: string, tickSize = '0.0100'): MarketSummary {
  return { symbol, priceScale: 4, quantityScale: 8, tickSize, bookDepth: 25 };
}

export function snapshot(symbol: string, sequence = '1'): BookSnapshotResponse {
  return { symbol, sequence, bids: [], asks: [] };
}

export class FakeChartSession implements ChartSession {
  readonly setDataCalls: Candle[][] = [];
  readonly updates: Candle[] = [];
  readonly resizeCalls: [number, number][] = [];
  disposeCalls = 0;

  setData(candles: readonly Candle[]): void {
    this.setDataCalls.push([...candles]);
  }

  update(value: Candle): void {
    this.updates.push(value);
  }

  resize(width: number, height: number): void {
    this.resizeCalls.push([width, height]);
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

export class FakeChartSessionFactory implements ChartSessionFactory {
  readonly created: { readonly scope: CandleScope; readonly session: FakeChartSession }[] = [];

  create(scope: CandleScope): FakeChartSession {
    const session = new FakeChartSession();
    this.created.push({ scope, session });
    return session;
  }
}

interface HistoryRequest {
  readonly symbol: string;
  readonly interval: Interval;
  readonly signal: AbortSignal;
  readonly response: Deferred<CandleHistoryResponse>;
}

export class DeferredHistorySource implements CandleHistorySource {
  readonly requests: HistoryRequest[] = [];

  fetch(symbol: string, interval: Interval, signal: AbortSignal): Promise<CandleHistoryResponse> {
    const response = deferred<CandleHistoryResponse>();
    this.requests.push({ symbol, interval, signal, response });
    return response.promise;
  }
}

interface SnapshotRequest {
  readonly symbol: string;
  readonly signal: AbortSignal;
  readonly response: Deferred<BookSnapshotResponse>;
}

export class DeferredSnapshotSource implements SnapshotSource {
  readonly requests: SnapshotRequest[] = [];

  fetchBookSnapshot(symbol: string, signal: AbortSignal): Promise<BookSnapshotResponse> {
    const response = deferred<BookSnapshotResponse>();
    this.requests.push({ symbol, signal, response });
    return response.promise;
  }
}
