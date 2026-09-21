'use client';

import type { MarketSummary } from '@repo/protocol';
import { useState } from 'react';
import {
  moveWatchlistItem,
  readWatchlistOrder,
  writeWatchlistOrder,
  type WatchlistOrderStorage,
} from '../watchlist/order';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'exaint.watchlist.order.v1';

function browserStorage(): WatchlistOrderStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface WatchlistProps {
  readonly markets: readonly MarketSummary[];
  readonly selectedSymbol: string | null;
  readonly onSelect: (market: MarketSummary) => void;
}

export function Watchlist({ markets, selectedSymbol, onSelect }: WatchlistProps) {
  const registryOrder = markets.map((market) => market.symbol);
  const [order, setOrder] = useState<string[]>(() =>
    readWatchlistOrder(browserStorage(), STORAGE_KEY, registryOrder),
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const orderedMarkets = order
    .map((symbol) => markets.find((market) => market.symbol === symbol))
    .filter((market): market is MarketSummary => market !== undefined);

  const move = (fromIndex: number, toIndex: number): void => {
    const next = moveWatchlistItem(order, fromIndex, toIndex);
    setOrder(next);
    writeWatchlistOrder(browserStorage(), STORAGE_KEY, next);
  };

  return (
    <nav
      className="watchlist shrink-0 h-9 bg-surface/95 border border-line flex items-stretch my-1"
      aria-label="Market watchlist"
    >
      <span className="watchlist-label grid place-items-center px-3 border-r border-line text-[8px] text-muted-foreground tracking-widest shrink-0 uppercase select-none">
        WATCH / 05
      </span>
      <div className="watchlist-track flex-1 flex overflow-x-auto no-scrollbar">
        {orderedMarkets.map((market, index) => (
          <div
            className={cn(
              'watch-item flex shrink-0 min-w-[112px] border-r border-line bg-transparent transition-colors',
              market.symbol === selectedSymbol && 'selected bg-signal/[0.07]',
            )}
            key={market.symbol}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedIndex !== null) move(draggedIndex, index);
              setDraggedIndex(null);
            }}
          >
            <button
              aria-label={`Reorder ${market.symbol}`}
              className="drag-handle size-9 min-w-9 flex items-center justify-center border-r border-line text-muted-foreground hover:text-signal cursor-grab active:cursor-grabbing text-xs transition-colors"
              draggable
              onClick={(event) => event.stopPropagation()}
              onDragEnd={() => setDraggedIndex(null)}
              onDragStart={(event) => {
                setDraggedIndex(index);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', market.symbol);
              }}
              onKeyDown={(event) => {
                const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                const next = event.key === 'ArrowRight' || event.key === 'ArrowDown';
                if (!previous && !next) return;
                event.preventDefault();
                move(index, Math.max(0, Math.min(order.length - 1, index + (previous ? -1 : 1))));
              }}
              type="button"
            >
              ⠿
            </button>
            <button
              className="watch-select flex-1 px-2.5 flex flex-col justify-center text-left hover:bg-white/[0.02] transition-colors"
              onClick={() => onSelect(market)}
              type="button"
            >
              <span
                className={cn(
                  'font-display font-extrabold text-xs tracking-wide leading-none',
                  market.symbol === selectedSymbol ? 'text-signal' : 'text-paper',
                )}
              >
                {market.symbol.split('-')[0]}
              </span>
              <small className="text-[7.5px] text-muted-foreground leading-none mt-1">
                {market.symbol}
              </small>
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
