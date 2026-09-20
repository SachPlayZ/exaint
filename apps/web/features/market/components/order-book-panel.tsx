'use client';

import type { MarketSummary } from '@repo/protocol';
import type { DisplayLevel } from '../orderbook/order-book-model';
import type { BookStatus } from '../orderbook/synchronizer';
import { formatMarketPrice, formatMarketQuantity } from './format';

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
    <div className={`book-row book-${props.side}`}>
      <span className="depth-bar" style={{ width: `${depthPercent(props.level, props.max)}%` }} />
      <span className="side-cue">{props.side === 'ask' ? '↑ ASK' : '↓ BID'}</span>
      <span>{formatMarketPrice(props.level.price, props.market)}</span>
      <span>{formatMarketQuantity(props.level.quantity, props.market)}</span>
      <span>{formatMarketQuantity(props.level.cumulative, props.market)}</span>
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
    <section className="panel book-panel" aria-labelledby="book-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DEPTH / LIVE</span>
          <h2 id="book-title">ORDER BOOK</h2>
        </div>
        <span className={`book-status book-status-${status.toLowerCase()}`}>{status}</span>
      </div>
      <div className="book-columns" aria-hidden="true">
        <span>SIDE</span>
        <span>PRICE</span>
        <span>SIZE</span>
        <span>TOTAL</span>
      </div>
      {market === null || (shownAsks.length === 0 && shownBids.length === 0) ? (
        <div className="panel-empty">WAITING FOR BOOK DEPTH</div>
      ) : (
        <div className="book-ladder">
          <div className="book-side asks">
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
          <div className="spread-marker">
            <span>SPREAD / CANONICAL</span>
            <i />
          </div>
          <div className="book-side bids">
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
