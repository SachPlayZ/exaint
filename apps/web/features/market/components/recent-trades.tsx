'use client';

import type { MarketSummary, Trade } from '@repo/protocol';
import { parsePrice, parseQuantity } from '@repo/protocol';
import { formatMarketPrice, formatMarketQuantity } from './format';
import { cn } from '@/lib/utils';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface RecentTradesProps {
  readonly market: MarketSummary | null;
  readonly trades: readonly Trade[];
}

export function RecentTrades({ market, trades }: RecentTradesProps) {
  return (
    <section
      className="h-[260px] md:h-[340px] md:col-span-1 xl:h-auto xl:flex-1 shrink-0 xl:shrink min-h-0 flex flex-col bg-surface/95 border border-line overflow-hidden"
      aria-labelledby="trades-title"
    >
      <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-line">
        <div>
          <span className="text-[8px] text-muted-foreground tracking-widest uppercase block">
            TAPE / LAST 50
          </span>
          <h2
            id="trades-title"
            className="font-display font-extrabold text-sm text-paper tracking-wide block leading-none mt-0.5"
          >
            RECENT TRADES
          </h2>
        </div>
        <span className="text-[9px] font-mono text-muted-foreground">
          {trades.length.toString().padStart(2, '0')}
        </span>
      </div>
      <div
        className="shrink-0 h-5.5 px-3 text-[8px] text-muted-foreground tracking-wider border-b border-line grid grid-cols-[0.9fr_1fr_1fr_0.7fr] items-center text-right font-mono"
        aria-hidden="true"
      >
        <span className="text-left">TIME</span>
        <span>PRICE</span>
        <span>AMOUNT</span>
        <span>SIDE</span>
      </div>
      {market === null || trades.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[9.5px] text-muted-foreground tracking-widest font-mono">
          WAITING FOR EXECUTIONS
        </div>
      ) : (
        <div className="trade-list flex-1 min-h-0 overflow-y-auto terminal-scrollbar font-mono">
          {trades.map((trade) => (
            <div
              className={cn(
                'trade-row h-5.5 px-3 border-b border-line/40 grid grid-cols-[0.9fr_1fr_1fr_0.7fr] items-center text-right text-[8.5px] leading-none',
                `trade-${trade.side}`,
                trade.side === 'buy' ? 'trade-buy' : 'trade-sell',
              )}
              key={trade.tradeId}
            >
              <time
                className="text-left text-muted-foreground text-[8px]"
                dateTime={new Date(trade.timestamp).toISOString()}
              >
                {timeFormatter.format(trade.timestamp)}
              </time>
              <span className="text-paper font-semibold">
                {formatMarketPrice(parsePrice(trade.price), market)}
              </span>
              <span className="text-muted-foreground">
                {formatMarketQuantity(parseQuantity(trade.quantity), market)}
              </span>
              <span
                className={cn(
                  'trade-side font-bold text-[8px]',
                  trade.side === 'buy' ? 'text-bid' : 'text-ask',
                )}
              >
                {trade.side === 'buy' ? 'BID ↗' : 'ASK ↘'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
