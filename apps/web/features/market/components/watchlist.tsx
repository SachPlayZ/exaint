'use client';

import type { MarketSummary } from '@repo/protocol';
import { useState } from 'react';
import {
  moveWatchlistItem,
  readWatchlistOrder,
  writeWatchlistOrder,
  type WatchlistOrderStorage,
} from '../watchlist/order';

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
    <nav className="watchlist" aria-label="Market watchlist">
      <span className="watchlist-label">WATCH / 05</span>
      <div className="watchlist-track">
        {orderedMarkets.map((market, index) => (
          <div
            className={`watch-item ${market.symbol === selectedSymbol ? 'selected' : ''}`}
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
              className="drag-handle"
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
            <button className="watch-select" onClick={() => onSelect(market)} type="button">
              <span>{market.symbol.split('-')[0]}</span>
              <small>{market.symbol}</small>
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
