'use client';

import type { Candle, Interval, MarketSummary } from '@repo/protocol';
import { parsePrice, parseQuantity } from '@repo/protocol';
import { useCallback } from 'react';
import { formatMarketPrice, formatMarketQuantity } from './format';

const INTERVALS: readonly Interval[] = ['1s', '5s', '1m'];

export interface ChartPanelProps {
  readonly onContainer: (element: HTMLDivElement | null) => void;
  readonly market: MarketSummary | null;
  readonly interval: Interval;
  readonly hover: Candle | null;
  readonly waiting: boolean;
  readonly onIntervalChange: (interval: Interval) => void;
}

export function ChartPanel({
  onContainer,
  market,
  interval: selectedInterval,
  hover,
  waiting,
  onIntervalChange,
}: ChartPanelProps) {
  const setContainer = useCallback(
    (element: HTMLDivElement | null) => onContainer(element),
    [onContainer],
  );
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-heading chart-heading">
        <div>
          <span className="eyebrow">PRICE ACTION / CANONICAL</span>
          <h2 id="chart-title">{market?.symbol ?? 'CANDLE CHART'}</h2>
        </div>
        <div className="interval-switcher" aria-label="Candle interval">
          {INTERVALS.map((interval) => (
            <button
              className={interval === selectedInterval ? 'active' : ''}
              key={interval}
              onClick={() => onIntervalChange(interval)}
              type="button"
            >
              {interval.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="ohlcv-strip" aria-live="polite">
        {market !== null && hover !== null ? (
          <>
            <time>{new Date(hover.startTime).toLocaleTimeString()}</time>
            <span>O {formatMarketPrice(parsePrice(hover.open), market)}</span>
            <span>H {formatMarketPrice(parsePrice(hover.high), market)}</span>
            <span>L {formatMarketPrice(parsePrice(hover.low), market)}</span>
            <span>C {formatMarketPrice(parsePrice(hover.close), market)}</span>
            <span>V {formatMarketQuantity(parseQuantity(hover.volume), market)}</span>
          </>
        ) : (
          <span>MOVE CROSSHAIR FOR OHLCV</span>
        )}
      </div>
      <div className="chart-stage" ref={setContainer}>
        {waiting ? <div className="chart-waiting">WAITING FOR MARKET DATA</div> : null}
      </div>
    </section>
  );
}
