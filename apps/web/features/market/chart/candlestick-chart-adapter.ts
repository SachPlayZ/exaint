import type { Candle } from '@repo/protocol';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventHandler,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface ChartHoverValue {
  readonly candle: Candle;
}

export interface ChartSession {
  setData(candles: readonly Candle[]): void;
  update(candle: Candle): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface ChartBackend {
  setData(data: readonly CandlestickData<Time>[]): void;
  update(data: CandlestickData<Time>, historicalUpdate: boolean): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface ChartBackendFactoryOptions {
  readonly precision: number;
  readonly minMove: number;
  readonly onCrosshairTime: (timeSeconds: number | null) => void;
}

export type ChartContainer = string | HTMLElement;

export type ChartBackendFactory = (
  container: ChartContainer,
  options: ChartBackendFactoryOptions,
) => ChartBackend;

export interface CandlestickChartAdapterOptions {
  readonly onHoverChange?: (value: ChartHoverValue | null) => void;
  /** Test seam: production always uses the Lightweight Charts backend below. */
  readonly createBackend?: ChartBackendFactory;
}

function precisionForTickSize(tickSize: string): number {
  const fraction = tickSize.split('.')[1] ?? '';
  return fraction.replace(/0+$/, '').length;
}

function toTimestamp(milliseconds: number): UTCTimestamp {
  const seconds = milliseconds / 1_000;
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new RangeError(`chart timestamp must be a non-negative whole second: ${milliseconds}`);
  }
  // Lightweight Charts brands epoch seconds. The integer check above is the runtime proof.
  return seconds as UTCTimestamp;
}

function toFiniteNumber(value: string, field: string): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new RangeError(`${field} is not chartable: ${value}`);
  return converted;
}

function toChartCandle(candle: Candle): CandlestickData<Time> {
  return {
    time: toTimestamp(candle.startTime),
    open: toFiniteNumber(candle.open, 'open'),
    high: toFiniteNumber(candle.high, 'high'),
    low: toFiniteNumber(candle.low, 'low'),
    close: toFiniteNumber(candle.close, 'close'),
  };
}

function createLightweightBackend(
  container: ChartContainer,
  options: ChartBackendFactoryOptions,
): ChartBackend {
  const chart: IChartApi = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#09090b' },
      textColor: '#a1a1aa',
    },
    grid: {
      vertLines: { color: '#18181b' },
      horzLines: { color: '#18181b' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
    timeScale: { timeVisible: true, secondsVisible: true },
  });
  const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
    upColor: '#34d399',
    downColor: '#fb7185',
    borderVisible: false,
    wickUpColor: '#34d399',
    wickDownColor: '#fb7185',
    priceFormat: {
      type: 'price',
      precision: options.precision,
      minMove: options.minMove,
    },
  });
  const crosshairHandler: MouseEventHandler<Time> = (event) => {
    options.onCrosshairTime(typeof event.time === 'number' ? event.time : null);
  };
  chart.subscribeCrosshairMove(crosshairHandler);

  return {
    setData: (data) => series.setData([...data]),
    update: (data, historicalUpdate) => series.update(data, historicalUpdate),
    resize: (width, height) => chart.resize(width, height),
    dispose: () => {
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.remove();
    },
  };
}

/** Imperative chart boundary. No live candle passes through React state. */
export class CandlestickChartAdapter implements ChartSession {
  readonly #backend: ChartBackend;
  readonly #onHoverChange: ((value: ChartHoverValue | null) => void) | undefined;
  readonly #candlesBySecond = new Map<number, Candle>();
  #latestStartTime = -1;
  #disposed = false;

  constructor(
    container: ChartContainer,
    tickSize: string,
    options: CandlestickChartAdapterOptions = {},
  ) {
    const precision = precisionForTickSize(tickSize);
    const minMove = Number(tickSize);
    if (!Number.isFinite(minMove) || minMove <= 0) {
      throw new RangeError(`tickSize is not chartable: ${tickSize}`);
    }
    this.#onHoverChange = options.onHoverChange;
    this.#backend = (options.createBackend ?? createLightweightBackend)(container, {
      precision,
      minMove,
      onCrosshairTime: (timeSeconds) => this.#onCrosshairTime(timeSeconds),
    });
  }

  setData(candles: readonly Candle[]): void {
    if (this.#disposed) return;
    this.#candlesBySecond.clear();
    this.#latestStartTime = -1;
    for (const candle of candles) {
      this.#candlesBySecond.set(candle.startTime / 1_000, candle);
      this.#latestStartTime = Math.max(this.#latestStartTime, candle.startTime);
    }
    this.#backend.setData(candles.map(toChartCandle));
  }

  update(candle: Candle): void {
    if (this.#disposed) return;
    const historicalUpdate = candle.startTime < this.#latestStartTime;
    this.#candlesBySecond.set(candle.startTime / 1_000, candle);
    this.#latestStartTime = Math.max(this.#latestStartTime, candle.startTime);
    this.#backend.update(toChartCandle(candle), historicalUpdate);
  }

  resize(width: number, height: number): void {
    if (this.#disposed) return;
    this.#backend.resize(width, height);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#candlesBySecond.clear();
    this.#onHoverChange?.(null);
    this.#backend.dispose();
  }

  #onCrosshairTime(timeSeconds: number | null): void {
    if (this.#disposed || this.#onHoverChange === undefined) return;
    const candle = timeSeconds === null ? undefined : this.#candlesBySecond.get(timeSeconds);
    this.#onHoverChange(candle === undefined ? null : { candle });
  }
}

export const chartTickPrecision = precisionForTickSize;
