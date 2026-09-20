'use client';

import type { MarketSummary, Trade } from '@repo/protocol';
import { parsePrice, parseQuantity } from '@repo/protocol';
import { formatMarketPrice, formatMarketQuantity } from './format';

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
    <section className="panel trades-panel" aria-labelledby="trades-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">TAPE / LAST 50</span>
          <h2 id="trades-title">RECENT TRADES</h2>
        </div>
        <span className="row-count">{trades.length.toString().padStart(2, '0')}</span>
      </div>
      <div className="trade-columns" aria-hidden="true">
        <span>TIME</span>
        <span>PRICE</span>
        <span>AMOUNT</span>
        <span>SIDE</span>
      </div>
      {market === null || trades.length === 0 ? (
        <div className="panel-empty">WAITING FOR EXECUTIONS</div>
      ) : (
        <div className="trade-list">
          {trades.map((trade) => (
            <div className={`trade-row trade-${trade.side}`} key={trade.tradeId}>
              <time dateTime={new Date(trade.timestamp).toISOString()}>
                {timeFormatter.format(trade.timestamp)}
              </time>
              <span>{formatMarketPrice(parsePrice(trade.price), market)}</span>
              <span>{formatMarketQuantity(parseQuantity(trade.quantity), market)}</span>
              <span className="trade-side">{trade.side === 'buy' ? 'BID ↗' : 'ASK ↘'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
