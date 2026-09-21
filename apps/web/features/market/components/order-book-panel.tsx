'use client';

import type { MarketSummary } from '@repo/protocol';
import type { DisplayLevel } from '../orderbook/order-book-model';
import type { BookStatus } from '../orderbook/synchronizer';
import { formatMarketPrice, formatMarketQuantity } from './format';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const DISPLAY_LEVELS = 12;

function depthPercent(level: DisplayLevel, max: bigint): number {
  if (max <= 0n) return 0;
  return Number((level.cumulative * 10_000n) / max) / 100;
}

function LevelRow(props: {
  readonly level: DisplayLevel;
  readonly max: bigint;
  readonly market: MarketSummary;
  readonly side: 'ask' | 'bid';
}) {
  return (
    <div
      className={cn(
        'book-row relative h-3.5 md:h-4 px-2.5 grid grid-cols-[46px_repeat(3,minmax(0,1fr))] items-center text-right text-[8px] md:text-[8.5px] leading-none select-none font-mono',
        props.side === 'ask' ? 'book-ask text-ask' : 'book-bid text-bid',
      )}
    >
      <span
        className="depth-bar absolute inset-y-0.5 right-0 opacity-10 pointer-events-none"
        style={{
          width: `${depthPercent(props.level, props.max)}%`,
          backgroundColor: props.side === 'ask' ? 'var(--ask)' : 'var(--bid)',
        }}
      />
      <span className="side-cue text-left text-muted-foreground text-[7.5px]">
        {props.side === 'ask' ? '↑ ASK' : '↓ BID'}
      </span>
      <span>{formatMarketPrice(props.level.price, props.market)}</span>
      <span className="text-paper">{formatMarketQuantity(props.level.quantity, props.market)}</span>
      <span className="text-muted-foreground">
        {formatMarketQuantity(props.level.cumulative, props.market)}
      </span>
    </div>
  );
}

export interface OrderBookPanelProps {
  readonly market: MarketSummary | null;
  readonly bids: readonly DisplayLevel[];
  readonly asks: readonly DisplayLevel[];
  readonly status: BookStatus;
}

export function OrderBookPanel({ market, bids, asks, status }: OrderBookPanelProps) {
  const shownAsks = [...asks.slice(0, DISPLAY_LEVELS)].reverse();
  const shownBids = bids.slice(0, DISPLAY_LEVELS);
  const max = [...shownAsks, ...shownBids].reduce(
    (current, level) => (level.cumulative > current ? level.cumulative : current),
    0n,
  );

  return (
    <section
      className="h-[360px] md:h-[340px] md:col-span-1 xl:h-auto xl:max-h-[58%] shrink-0 flex flex-col bg-surface/95 border border-line overflow-hidden"
      aria-labelledby="book-title"
    >
      <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-line">
        <div>
          <span className="text-[8px] text-muted-foreground tracking-widest uppercase block">
            DEPTH / LIVE
          </span>
          <h2
            id="book-title"
            className="font-display font-extrabold text-sm text-paper tracking-wide block leading-none mt-0.5"
          >
            ORDER BOOK
          </h2>
        </div>
        <span
          className={cn(
            'book-status text-[8.5px] font-mono tracking-wider font-semibold',
            status === 'SYNCHRONIZED' && 'text-signal',
            status === 'RESYNCING' && 'text-amber',
          )}
        >
          {status}
        </span>
      </div>
      <div
        className="shrink-0 h-5.5 px-2.5 text-[8px] text-muted-foreground tracking-wider border-b border-line grid grid-cols-[46px_repeat(3,minmax(0,1fr))] items-center text-right font-mono"
        aria-hidden="true"
      >
        <span className="text-left">SIDE</span>
        <span>PRICE</span>
        <span>SIZE</span>
        <span>TOTAL</span>
      </div>
      {market === null || (shownAsks.length === 0 && shownBids.length === 0) ? (
        <div className="py-12 flex items-center justify-center text-center text-[9.5px] text-muted-foreground tracking-widest font-mono">
          WAITING FOR BOOK DEPTH
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col justify-between py-1">
          <div className="flex flex-col justify-around">
            {shownAsks.map((level) => (
              <LevelRow
                key={level.price.toString()}
                level={level}
                max={max}
                market={market}
                side="ask"
              />
            ))}
          </div>
          <div className="shrink-0 h-5 px-2.5 flex items-center gap-2 text-[8px] text-amber font-mono">
            <span className="whitespace-nowrap">SPREAD / CANONICAL</span>
            <Separator className="flex-1 bg-line-bright h-px" />
          </div>
          <div className="flex flex-col justify-around">
            {shownBids.map((level) => (
              <LevelRow
                key={level.price.toString()}
                level={level}
                max={max}
                market={market}
                side="bid"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
