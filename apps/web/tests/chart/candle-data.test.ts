import { describe, expect, it } from 'vitest';
import { mergeCandles } from '../../features/market/chart/candle-data.js';
import { candle } from './helpers.js';

describe('candle merge', () => {
  it('deduplicates by scoped start time and compares trade ids numerically', () => {
    const older = candle('BTC-USD', 1_700_000_000_000, '9');
    const newer = candle('BTC-USD', 1_700_000_000_000, '10', { close: '105.0000' });
    const next = candle('BTC-USD', 1_700_000_001_000, '11');

    expect(mergeCandles({ symbol: 'BTC-USD', interval: '1s' }, [older, next], [newer])).toEqual([
      newer,
      next,
    ]);
  });

  it('rejects candles from another symbol', () => {
    const btc = candle('BTC-USD', 1_700_000_000_000, '1');
    const sol = candle('SOL-USD', 1_700_000_000_000, '1');

    expect(mergeCandles({ symbol: 'BTC-USD', interval: '1s' }, [btc], [sol])).toEqual([btc]);
  });
});
