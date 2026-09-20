import type { CandlestickData, Time } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import {
  CandlestickChartAdapter,
  type ChartBackend,
  type ChartBackendFactoryOptions,
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
});
