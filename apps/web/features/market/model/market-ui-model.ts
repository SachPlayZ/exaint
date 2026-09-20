import type { Trade } from '@repo/protocol';
import { parseIdentifier } from '@repo/protocol';
import type { DisplayLevel } from '../orderbook/order-book-model';

const RECENT_TRADE_LIMIT = 50;

export type MarketUiTrade = Readonly<Trade>;

export interface TopOrderBookLevels {
  readonly bids: readonly DisplayLevel[];
  readonly asks: readonly DisplayLevel[];
}

export interface MarketUiSnapshot {
  readonly selectedSymbol: string;
  readonly latestPrice: string | null;
  readonly sessionBaselinePrice: string | null;
  readonly lastTradeId: string | null;
  readonly recentTrades: readonly MarketUiTrade[];
  readonly bids: readonly Readonly<DisplayLevel>[];
  readonly asks: readonly Readonly<DisplayLevel>[];
}

interface SymbolTradeState {
  baselinePrice: string | null;
  lastTradeId: bigint | null;
  latestPrice: string | null;
  recentTrades: Map<bigint, MarketUiTrade>;
}

interface IdentifiedTrade {
  readonly id: bigint;
  readonly trade: Trade;
}

const freezeTrade = (trade: Trade): MarketUiTrade => Object.freeze({ ...trade });

const freezeLevel = (level: DisplayLevel): Readonly<DisplayLevel> =>
  Object.freeze({
    price: level.price,
    quantity: level.quantity,
    cumulative: level.cumulative,
  });

const compareIdentifiers = (left: bigint, right: bigint): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** React-free market state. Identifier ordering is always scoped to one symbol. */
export class MarketUiModel {
  #selectedSymbol: string;
  readonly #symbols = new Map<string, SymbolTradeState>();

  constructor(selectedSymbol: string) {
    this.#selectedSymbol = selectedSymbol;
  }

  get selectedSymbol(): string {
    return this.#selectedSymbol;
  }

  selectSymbol(symbol: string): void {
    if (symbol === this.#selectedSymbol) return;
    this.#symbols.delete(this.#selectedSymbol);
    this.#selectedSymbol = symbol;
  }

  processTrades(trades: readonly Trade[]): void {
    const bySymbol = new Map<string, IdentifiedTrade[]>();

    for (const trade of trades) {
      const identified = { id: parseIdentifier(trade.tradeId), trade };
      const symbolTrades = bySymbol.get(trade.symbol);
      if (symbolTrades === undefined) bySymbol.set(trade.symbol, [identified]);
      else symbolTrades.push(identified);
    }

    for (const [symbol, identifiedTrades] of bySymbol) {
      const state = this.#stateFor(symbol);
      identifiedTrades.sort((left, right) => compareIdentifiers(left.id, right.id));

      for (const { id, trade } of identifiedTrades) {
        if (state.recentTrades.has(id)) continue;

        const immutableTrade = freezeTrade(trade);
        if (state.baselinePrice === null) state.baselinePrice = immutableTrade.price;
        state.recentTrades.set(id, immutableTrade);

        if (state.lastTradeId === null || id > state.lastTradeId) {
          state.lastTradeId = id;
          state.latestPrice = immutableTrade.price;
        }
      }

      state.recentTrades = new Map(
        [...state.recentTrades.entries()]
          .sort(([left], [right]) => compareIdentifiers(right, left))
          .slice(0, RECENT_TRADE_LIMIT),
      );
    }
  }

  snapshot(book: TopOrderBookLevels = { bids: [], asks: [] }): Readonly<MarketUiSnapshot> {
    const state = this.#symbols.get(this.#selectedSymbol);
    const recentTrades = Object.freeze([...(state?.recentTrades.values() ?? [])]);
    const bids = Object.freeze(book.bids.map(freezeLevel));
    const asks = Object.freeze(book.asks.map(freezeLevel));

    return Object.freeze({
      selectedSymbol: this.#selectedSymbol,
      latestPrice: state?.latestPrice ?? null,
      sessionBaselinePrice: state?.baselinePrice ?? null,
      lastTradeId: state?.lastTradeId?.toString() ?? null,
      recentTrades,
      bids,
      asks,
    });
  }

  #stateFor(symbol: string): SymbolTradeState {
    const current = this.#symbols.get(symbol);
    if (current !== undefined) return current;

    const created: SymbolTradeState = {
      baselinePrice: null,
      lastTradeId: null,
      latestPrice: null,
      recentTrades: new Map(),
    };
    this.#symbols.set(symbol, created);
    return created;
  }
}
