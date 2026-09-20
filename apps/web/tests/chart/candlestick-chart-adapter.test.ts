import type { CandlestickData, Time } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import {
  CandlestickChartAdapter,
  type AnimationFrameApi,
  type ChartBackend,
  type ChartBackendFactoryOptions,
  type ResizeObserverHandle,
} from '../../features/market/chart/candlestick-chart-adapter.js';
import { candle } from './helpers.js';

describe('CandlestickChartAdapter', () => {
  it('owns conversion, tick formatting, hover, resize, and idempotent disposal', () => {
    const setData = vi.fn<(data: readonly CandlestickData<Time>[]) => void>();
    const update = vi.fn<(data: CandlestickData<Time>, historical: boolean) => void>();
    const resize = vi.fn<(width: number, height: number) => void>();
    const dispose = vi.fn<() => void>();
    let backendOptions: ChartBackendFactoryOptions | undefined;
    const backend: ChartBackend = { setData, update, resize, dispose };
    const hover = vi.fn();
    const adapter = new CandlestickChartAdapter('#chart', '0.1000', {
      onHoverChange: hover,
      createBackend: (_container, options) => {
        backendOptions = options;
        return backend;
      },
    });
    const first = candle('BTC-USD', 1_700_000_000_000, '1');
    const historical = candle('BTC-USD', 1_699_999_999_000, '2');

    adapter.setData([first]);
    adapter.update(historical);
    adapter.resize(800, 400);
    backendOptions?.onCrosshairTime(first.startTime / 1_000);
    backendOptions?.onCrosshairTime(null);
    adapter.dispose();
    adapter.dispose();

    expect(backendOptions).toMatchObject({ precision: 1, minMove: 0.1 });
    expect(setData).toHaveBeenCalledWith([
      { time: first.startTime / 1_000, open: 100, high: 102, low: 99, close: 101 },
    ]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ time: 1_699_999_999 }), true);
    expect(resize).toHaveBeenCalledWith(800, 400);
    expect(hover.mock.calls).toEqual([[{ candle: first }], [null], [null]]);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('coalesces observer resizes into one frame and cancels pending work on disposal', () => {
    vi.stubGlobal('HTMLElement', class {});
    const container = new HTMLElement();
    const resize = vi.fn<(width: number, height: number) => void>();
    const disconnect = vi.fn<() => void>();
    const observe = vi.fn<(element: Element) => void>();
    let onResize: ((width: number, height: number) => void) | undefined;
    let frameCallback: (() => void) | undefined;
    const animationFrame: AnimationFrameApi = {
      request: (callback) => {
        frameCallback = callback;
        return 7;
      },
      cancel: vi.fn(),
    };
    const observer: ResizeObserverHandle = { observe, disconnect };
    const adapter = new CandlestickChartAdapter(container, '0.1000', {
      createBackend: () => ({
        setData: vi.fn(),
        update: vi.fn(),
        resize,
        dispose: vi.fn(),
      }),
      createResizeObserver: (callback) => {
        onResize = callback;
        return observer;
      },
      animationFrame,
    });

    onResize?.(640, 360);
    onResize?.(800, 420);
    expect(observe).toHaveBeenCalledWith(container);
    expect(resize).not.toHaveBeenCalled();
    frameCallback?.();
    expect(resize).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith(800, 420);

    onResize?.(900, 500);
    adapter.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(animationFrame.cancel).toHaveBeenCalledWith(7);
    vi.unstubAllGlobals();
  });
});
