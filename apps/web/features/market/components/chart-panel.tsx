'use client';

import type { Candle, Interval, MarketSummary } from '@repo/protocol';
import { parsePrice, parseQuantity } from '@repo/protocol';
import { useCallback } from 'react';
import { formatMarketPrice, formatMarketQuantity } from './format';
import { cn } from '@/lib/utils';

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
    <section
      className="h-[320px] md:h-[380px] md:col-span-2 xl:h-auto xl:flex-1 shrink-0 xl:shrink min-h-0 flex flex-col bg-surface/95 border border-line overflow-hidden"
      aria-labelledby="chart-title"
    >
      <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-line gap-2.5">
        <div>
          <span className="text-[8px] text-muted-foreground tracking-widest uppercase block">
            PRICE ACTION / CANONICAL
          </span>
          <h2
            id="chart-title"
            className="font-display font-extrabold text-sm text-paper tracking-wide block leading-none mt-0.5"
          >
            {market?.symbol ?? 'CANDLE CHART'}
          </h2>
        </div>
        <div
          className="flex border border-line rounded overflow-hidden"
          aria-label="Candle interval"
        >
          {INTERVALS.map((interval) => (
            <button
              className={cn(
                'px-2.5 h-6 text-[9.5px] font-mono border-r border-line last:border-r-0 transition-colors cursor-pointer',
                interval === selectedInterval
                  ? 'active bg-signal text-ink font-bold'
                  : 'text-muted-foreground hover:text-paper hover:bg-white/[0.03]',
              )}
              key={interval}
              onClick={() => onIntervalChange(interval)}
              type="button"
            >
              {interval.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div
        className="ohlcv-strip shrink-0 h-6.5 px-3 flex items-center gap-3 border-b border-line text-[9px] text-muted-foreground overflow-x-auto whitespace-nowrap font-mono"
        aria-live="polite"
      >
        {market !== null && hover !== null ? (
          <>
            <time className="text-paper">{new Date(hover.startTime).toLocaleTimeString()}</time>
            <span>
              O{' '}
              <strong className="text-paper font-normal">
                {formatMarketPrice(parsePrice(hover.open), market)}
              </strong>
            </span>
            <span>
              H{' '}
              <strong className="text-paper font-normal">
                {formatMarketPrice(parsePrice(hover.high), market)}
              </strong>
            </span>
            <span>
              L{' '}
              <strong className="text-paper font-normal">
                {formatMarketPrice(parsePrice(hover.low), market)}
              </strong>
            </span>
            <span>
              C{' '}
              <strong className="text-paper font-normal">
                {formatMarketPrice(parsePrice(hover.close), market)}
              </strong>
            </span>
            <span>
              V{' '}
              <strong className="text-paper font-normal">
                {formatMarketQuantity(parseQuantity(hover.volume), market)}
              </strong>
            </span>
          </>
        ) : (
          <span>MOVE CROSSHAIR FOR OHLCV</span>
        )}
      </div>
      <div className="flex-1 min-h-0 w-full relative" ref={setContainer}>
        {waiting ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/40 text-[10px] text-muted-foreground tracking-widest font-mono">
            WAITING FOR MARKET DATA
          </div>
        ) : null}
      </div>
    </section>
  );
}
