import { describe, expect, it } from 'vitest';
import { CandleHistoryController } from '../../features/market/chart/candle-history-controller.js';
import { candle, DeferredHistorySource, FakeChartSessionFactory, history } from './helpers.js';

describe('T5 late history response', () => {
  it('keeps the newer interval when an aborted request finishes late', async () => {
    const source = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const controller = new CandleHistoryController(source, sessions);

    const oneMinute = controller.select({ symbol: 'BTC-USD', interval: '1m', tickSize: '0.1000' });
    const fiveSeconds = controller.select({
      symbol: 'BTC-USD',
      interval: '5s',
      tickSize: '0.1000',
    });
    const request1m = source.requests[0];
    const request5s = source.requests[1];
    expect(request1m?.signal.aborted).toBe(true);

    const fiveSecondCandle = candle('BTC-USD', 1_700_000_000_000, '5');
    request5s?.response.resolve(history('BTC-USD', '5s', [fiveSecondCandle]));
    await expect(fiveSeconds).resolves.toBe('applied');

    request1m?.response.resolve(
      history('BTC-USD', '1m', [candle('BTC-USD', 1_699_999_980_000, '4')]),
    );
    await expect(oneMinute).resolves.toBe('superseded');

    expect(sessions.created).toHaveLength(1);
    expect(sessions.created[0]?.scope.interval).toBe('5s');
    expect(sessions.created[0]?.session.setDataCalls).toEqual([[fiveSecondCandle]]);
  });

  it('buffers live data during history and streams every newer candle afterward', async () => {
    const source = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const controller = new CandleHistoryController(source, sessions);
    const selected = controller.select({ symbol: 'BTC-USD', interval: '1s', tickSize: '0.1000' });
    const base = candle('BTC-USD', 1_700_000_000_000, '9');
    const liveRevision = candle('BTC-USD', base.startTime, '10', { close: '103.0000' });

    controller.onCandles({
      type: 'candles.update',
      symbol: 'BTC-USD',
      interval: '1s',
      candles: [liveRevision],
    });
    source.requests[0]?.response.resolve(history('BTC-USD', '1s', [base]));
    await selected;

    const next = candle('BTC-USD', base.startTime + 1_000, '11');
    const nextActive = candle('BTC-USD', base.startTime + 2_000, '12');
    controller.onCandles({
      type: 'candles.update',
      symbol: 'BTC-USD',
      interval: '1s',
      candles: [next, nextActive, base],
    });
    controller.onCandles({
      type: 'candles.update',
      symbol: 'SOL-USD',
      interval: '1s',
      candles: [candle('SOL-USD', base.startTime + 3_000, '1')],
    });

    const session = sessions.created[0]?.session;
    expect(session?.setDataCalls).toEqual([[liveRevision]]);
    expect(session?.updates).toEqual([next, nextActive]);
    expect(controller.hasCandles).toBe(true);
  });

  it('disposes the previous chart only after replacement history is ready', async () => {
    const source = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const controller = new CandleHistoryController(source, sessions);

    const first = controller.select({ symbol: 'BTC-USD', interval: '1s', tickSize: '0.1000' });
    source.requests[0]?.response.resolve(history('BTC-USD', '1s', []));
    await first;
    const firstSession = sessions.created[0]?.session;
    expect(controller.hasCandles).toBe(false);

    const second = controller.select({ symbol: 'BTC-USD', interval: '5s', tickSize: '0.1000' });
    expect(firstSession?.disposeCalls).toBe(0);
    source.requests[1]?.response.resolve(history('BTC-USD', '5s', []));
    await second;

    expect(firstSession?.disposeCalls).toBe(1);
    controller.dispose();
    expect(sessions.created[1]?.session.disposeCalls).toBe(1);
    expect(controller.hasCandles).toBe(false);
  });

  it('returns to the active chart when replacement history fails', async () => {
    const source = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const controller = new CandleHistoryController(source, sessions);
    const first = controller.select({ symbol: 'BTC-USD', interval: '1s', tickSize: '0.1000' });
    source.requests[0]?.response.resolve(history('BTC-USD', '1s', []));
    await first;

    const failed = controller.select({ symbol: 'BTC-USD', interval: '5s', tickSize: '0.1000' });
    source.requests[1]?.response.reject(new Error('history unavailable'));
    await expect(failed).rejects.toThrow('history unavailable');

    const live = candle('BTC-USD', 1_700_000_000_000, '1');
    controller.onCandles({
      type: 'candles.update',
      symbol: 'BTC-USD',
      interval: '1s',
      candles: [live],
    });
    expect(sessions.created[0]?.session.updates).toEqual([live]);
  });

  it('keeps ingesting while hidden without repainting, then renders once on wake', async () => {
    const source = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const controller = new CandleHistoryController(source, sessions);
    const selected = controller.select({ symbol: 'BTC-USD', interval: '1s', tickSize: '0.1000' });
    const base = candle('BTC-USD', 1_700_000_000_000, '1');
    source.requests[0]?.response.resolve(history('BTC-USD', '1s', [base]));
    await selected;

    controller.setRenderingPaused(true);
    const live = candle('BTC-USD', base.startTime + 1_000, '2');
    controller.onCandles({
      type: 'candles.update',
      symbol: 'BTC-USD',
      interval: '1s',
      candles: [live],
    });
    expect(sessions.created[0]?.session.updates).toEqual([]);

    controller.setRenderingPaused(false);
    expect(sessions.created[0]?.session.setDataCalls).toEqual([[base], [base, live]]);
  });

  it('accepts empty history, then live data, then a seamless real-history replacement', async () => {
    const source = new DeferredHistorySource();
    const sessions = new FakeChartSessionFactory();
    const controller = new CandleHistoryController(source, sessions);
    const empty = controller.select({ symbol: 'BTC-USD', interval: '1s', tickSize: '0.1000' });
    source.requests[0]?.response.resolve(history('BTC-USD', '1s', []));
    await empty;
    expect(sessions.created[0]?.session.setDataCalls).toEqual([[]]);

    const live = candle('BTC-USD', 1_700_000_000_000, '1');
    controller.onCandles({
      type: 'candles.update',
      symbol: 'BTC-USD',
      interval: '1s',
      candles: [live],
    });
    expect(sessions.created[0]?.session.updates).toEqual([live]);

    const replacement = controller.select({
      symbol: 'BTC-USD',
      interval: '1s',
      tickSize: '0.1000',
    });
    source.requests[1]?.response.resolve(history('BTC-USD', '1s', [live]));
    await replacement;
    expect(sessions.created[0]?.session.disposeCalls).toBe(1);
    expect(sessions.created[1]?.session.setDataCalls).toEqual([[live]]);
  });
});
