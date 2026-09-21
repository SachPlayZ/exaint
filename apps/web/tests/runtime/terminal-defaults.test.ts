import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_INTERVAL } from '../../features/market/runtime/terminal-runtime.js';

describe('terminal defaults', () => {
  it('opens on the calmer 5s candle interval while leaving 1s selectable', () => {
    expect(DEFAULT_CHART_INTERVAL).toBe('5s');
  });
});
