import type { BookDelta, BookSnapshot, Candle, Trade } from '@repo/protocol';
import { formatIdentifier, formatPrice, formatQuantity } from '@repo/protocol';
import type { DomainCandle } from '../market/candles/candle.js';
import type {
  DomainBookDelta,
  DomainBookLevel,
  DomainBookSnapshot,
  DomainTrade,
} from '../market/events.js';

/**
 * The JSON boundary. `bigint` lives on one side of these functions and decimal
 * strings on the other — nothing else in the process converts between them
 * (docs/01-protocol.md §3, docs/02-market-domain.md §5).
 *
 * A stray `bigint` reaching `JSON.stringify` is a runtime `TypeError`, so every
 * outbound payload goes through here.
 */

function encodeLevels(levels: readonly DomainBookLevel[]): [string, string][] {
  return levels.map(([price, quantity]) => [
    formatPrice(price),
    // "0" is the documented delete sentinel and stays exactly that, rather than
    // becoming "0.00000000" and losing the normative wire shape.
    quantity === 0n ? '0' : formatQuantity(quantity),
  ]);
}

export function encodeTrade(trade: DomainTrade): Trade {
  return {
    type: 'trade',
    symbol: trade.symbol,
    tradeId: formatIdentifier(trade.tradeId),
    timestamp: trade.timestamp,
    side: trade.side,
    price: formatPrice(trade.price),
    quantity: formatQuantity(trade.quantity),
  };
}

export function encodeBookSnapshot(snapshot: DomainBookSnapshot): BookSnapshot {
  return {
    symbol: snapshot.symbol,
    sequence: formatIdentifier(snapshot.sequence),
    bids: encodeLevels(snapshot.bids),
    asks: encodeLevels(snapshot.asks),
  };
}

export function encodeBookDelta(delta: DomainBookDelta): BookDelta {
  return {
    type: 'book.delta',
    symbol: delta.symbol,
    previousSequence: formatIdentifier(delta.previousSequence),
    sequence: formatIdentifier(delta.sequence),
    timestamp: delta.timestamp,
    bids: encodeLevels(delta.bids),
    asks: encodeLevels(delta.asks),
  };
}

/**
 * `final` is added here, not stored on the domain candle: finality is a fact
 * about the clock, and the transport is what states it.
 */
export function encodeCandle(candle: DomainCandle, final: boolean): Candle {
  return {
    symbol: candle.symbol,
    startTime: candle.startTime,
    open: formatPrice(candle.open),
    high: formatPrice(candle.high),
    low: formatPrice(candle.low),
    close: formatPrice(candle.close),
    volume: formatQuantity(candle.volume),
    tradeCount: candle.tradeCount,
    lastTradeId: formatIdentifier(candle.lastTradeId),
    final,
  };
}
