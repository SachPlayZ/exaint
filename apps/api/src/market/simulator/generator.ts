import type { Side } from '@repo/protocol';
import type { DomainTrade } from '../events.js';
import { clampBigInt, floorToTick, maxBigInt, minBigInt } from '../fixed-point.js';
import type { OrderBook, BookSide } from '../orderbook/order-book.js';
import { ORDER_FLOW_PERSISTENCE, type SymbolConfig } from '../symbol-config.js';
import type { Prng } from './prng.js';

/**
 * Event generation for **one** symbol. Three event kinds, exactly as
 * docs/02-market-domain.md §6 describes: new limit order, cancellation/update,
 * and market trade.
 *
 * This is not a matching engine and does not need to be. What it does need is a
 * coherent relationship between trades and the book: a buy consumes asks, a sell
 * consumes bids, and a print never happens at a price no level ever offered.
 *
 * Price discovery works the way a real market's does — the fair value walks, and
 * the book follows because stale quotes get *traded through*, not silently
 * deleted.
 */
export class MarketSimulator {
  readonly config: SymbolConfig;
  readonly #prng: Prng;
  #fairValue: bigint;
  #lastNoiseSide: Side | null = null;
  #trendVelocity = 0n;
  #regimeTicksRemaining = 0;
  readonly #floor: bigint;
  readonly #ceiling: bigint;

  constructor(config: SymbolConfig, prng: Prng) {
    if (config.levelSpacing % config.tickSize !== 0n) {
      throw new RangeError(`${config.symbol}: levelSpacing must be a multiple of tickSize`);
    }
    this.config = config;
    this.#prng = prng;
    this.#fairValue = config.basePrice;
    // A seeded walk left alone for hours must not reach zero or run away.
    this.#floor = config.basePrice / 4n;
    this.#ceiling = config.basePrice * 4n;
  }

  get fairValue(): bigint {
    return this.#fairValue;
  }

  /** Builds the opening ladder. Emits no delta — the book opens at sequence 0. */
  seedBook(book: OrderBook): void {
    const { bid, ask } = this.#targets();
    this.#requote(book, bid, ask);
    this.#replenish(book, bid, ask);
    book.trim();
    book.clearPendingChanges();
  }

  /** Advances this symbol by one logical tick. */
  tick(book: OrderBook, timestamp: number, allocateTradeId: () => bigint): DomainTrade[] {
    const trades: DomainTrade[] = [];

    // Advance or select the active market regime (trend vs consolidation).
    this.#updateRegime();

    const randomStep = this.#prng.nextBellBetween(this.config.volatility);
    this.#fairValue = clampBigInt(
      this.#fairValue + randomStep + this.#trendVelocity,
      this.#floor,
      this.#ceiling,
    );
    const { bid: desiredBid, ask: desiredAsk } = this.#targets();

    // Price discovery: lift stale offers, hit stale bids.
    this.#fill(book, trades, 'buy', null, desiredAsk, timestamp, allocateTradeId);
    this.#fill(book, trades, 'sell', null, desiredBid, timestamp, allocateTradeId);

    // Liquidation cascades / multi-level sweep events:
    // Occasional forced flow sweeps 2–4 consecutive resting levels, shifting the spread.
    if (this.config.volatility > 0n && this.#prng.nextFloat() < 0.018) {
      this.#executeCascade(book, trades, timestamp, allocateTradeId);
    }

    // Noise: a trade that is not explained by the fair value moving.
    if (this.#prng.nextFloat() < this.config.tradeProbability) {
      const side = this.#nextNoiseSide();
      const quantity = this.#prng.nextBigIntBetween(
        this.config.minTradeQuantity,
        this.config.maxTradeQuantity,
      );
      this.#fill(book, trades, side, quantity, null, timestamp, allocateTradeId);
    }

    this.#churn(book);
    this.#requote(book, desiredBid, desiredAsk);
    this.#replenish(book, desiredBid, desiredAsk);
    book.trim();

    return trades;
  }

  /**
   * Selects or steps the active market regime:
   * - 50%: range-bound consolidation (zero trend drift).
   * - 25%: bullish trend push (positive drift pulling fair value up).
   * - 25%: bearish trend pull (negative drift pulling fair value down).
   */
  #updateRegime(): void {
    if (this.config.volatility === 0n) {
      this.#trendVelocity = 0n;
      this.#regimeTicksRemaining = 0;
      return;
    }

    this.#regimeTicksRemaining -= 1;
    if (this.#regimeTicksRemaining <= 0) {
      const roll = this.#prng.nextFloat();
      if (roll < 0.5) {
        // Consolidation: 30 to 80 ticks (1.5s to 4.0s)
        this.#trendVelocity = 0n;
        this.#regimeTicksRemaining = this.#prng.nextIntBetween(30, 80);
      } else if (roll < 0.75) {
        // Bullish push: 20 to 50 ticks (1.0s to 2.5s)
        this.#trendVelocity = this.config.volatility;
        this.#regimeTicksRemaining = this.#prng.nextIntBetween(20, 50);
      } else {
        // Bearish pullback: 20 to 50 ticks (1.0s to 2.5s)
        this.#trendVelocity = -this.config.volatility;
        this.#regimeTicksRemaining = this.#prng.nextIntBetween(20, 50);
      }
    }
  }

  /**
   * Simulates a liquidation cascade or aggressive whale sweep:
   * Consumes 2 to 4 consecutive price levels from the opposite side of the book,
   * moving the touch and causing the price ladder to visibly advance.
   */
  #executeCascade(
    book: OrderBook,
    sink: DomainTrade[],
    timestamp: number,
    allocateTradeId: () => bigint,
  ): void {
    // Cascade direction is biased towards the prevailing trend.
    let cascadeSide: Side;
    if (this.#trendVelocity > 0n) {
      cascadeSide = this.#prng.nextFloat() < 0.75 ? 'buy' : 'sell';
    } else if (this.#trendVelocity < 0n) {
      cascadeSide = this.#prng.nextFloat() < 0.75 ? 'sell' : 'buy';
    } else {
      cascadeSide = this.#prng.nextBoolean() ? 'buy' : 'sell';
    }

    const opposite: BookSide = cascadeSide === 'buy' ? 'ask' : 'bid';
    const prices = book.prices(opposite);
    if (prices.length === 0) return;

    const levelsToSweep = minBigInt(BigInt(this.#prng.nextIntBetween(2, 4)), BigInt(prices.length));

    for (let index = 0; index < Number(levelsToSweep); index += 1) {
      const price = prices[index];
      if (price === undefined) break;
      const available = book.quantityAt(opposite, price);
      if (available <= 0n) continue;

      book.setLevel(opposite, price, 0n);
      sink.push({
        symbol: this.config.symbol,
        tradeId: allocateTradeId(),
        timestamp,
        side: cascadeSide,
        price,
        quantity: available,
      });
    }

    // Pull fair value towards the swept touch so the market consolidates at the new level.
    const newTouch = book.best(opposite);
    if (newTouch !== undefined) {
      this.#fairValue = clampBigInt(newTouch, this.#floor, this.#ceiling);
    }
  }

  /** Grid-aligned best bid and best ask implied by the current fair value. */
  #targets(): { bid: bigint; ask: bigint } {
    const anchor = floorToTick(this.#fairValue, this.config.levelSpacing);
    return {
      bid: anchor,
      ask: anchor + this.config.levelSpacing * BigInt(this.config.spreadSpacings),
    };
  }

  #randomLevelQuantity(): bigint {
    return this.#prng.nextBigIntBetween(this.config.minLevelQuantity, this.config.maxLevelQuantity);
  }

  /**
   * Real order flow clusters. A Markov side process avoids artificial bid/ask
   * flipping on every tick while staying deterministic for a given seed.
   */
  #nextNoiseSide(): Side {
    if (this.#lastNoiseSide === null) {
      this.#lastNoiseSide = this.#prng.nextBoolean() ? 'buy' : 'sell';
      return this.#lastNoiseSide;
    }
    if (this.#prng.nextFloat() >= ORDER_FLOW_PERSISTENCE) {
      this.#lastNoiseSide = this.#lastNoiseSide === 'buy' ? 'sell' : 'buy';
    }
    return this.#lastNoiseSide;
  }

  /**
   * Consumes the opposite side, one print per price level.
   *
   * `quantity` caps the size; `limitPrice` caps how far the fill may walk — a buy
   * stops at the first ask priced at or above the limit. Exactly one of the two
   * is given.
   */
  #fill(
    book: OrderBook,
    sink: DomainTrade[],
    side: Side,
    quantity: bigint | null,
    limitPrice: bigint | null,
    timestamp: number,
    allocateTradeId: () => bigint,
  ): void {
    const opposite: BookSide = side === 'buy' ? 'ask' : 'bid';
    let remaining = quantity;

    for (const price of book.prices(opposite)) {
      if (remaining !== null && remaining <= 0n) break;
      if (limitPrice !== null) {
        if (side === 'buy' && price >= limitPrice) break;
        if (side === 'sell' && price <= limitPrice) break;
      }

      const available = book.quantityAt(opposite, price);
      if (available <= 0n) continue;
      const taken = remaining === null ? available : minBigInt(available, remaining);

      book.addQuantity(opposite, price, -taken);
      if (remaining !== null) remaining -= taken;

      sink.push({
        symbol: this.config.symbol,
        tradeId: allocateTradeId(),
        timestamp,
        side,
        price,
        quantity: taken,
      });
    }
  }

  /** New limit orders and cancellations, always at or outside the current best. */
  #churn(book: OrderBook): void {
    for (let event = 0; event < this.config.churnEvents; event += 1) {
      const side: BookSide = this.#prng.nextBoolean() ? 'bid' : 'ask';
      const prices = book.prices(side);
      if (prices.length === 0) continue;

      const price = prices[this.#prng.nextIntBetween(0, prices.length - 1)];
      if (price === undefined) continue;

      if (this.#prng.nextFloat() < 0.6) {
        // New limit order: adds liquidity to an existing level.
        book.addQuantity(side, price, this.#randomLevelQuantity() / 4n);
      } else {
        // Cancellation or resize: keeps 0–75% of what was resting there.
        const keptPercent = this.#prng.nextBigIntBetween(0n, 75n);
        book.setLevel(side, price, (book.quantityAt(side, price) * keptPercent) / 100n);
      }
    }
  }

  /**
   * Re-quotes the top of book toward the fair value. Targets are clamped against
   * the opposite side, so the book can never cross: `bestBid < bestAsk` holds by
   * construction, not by luck.
   */
  #requote(book: OrderBook, desiredBid: bigint, desiredAsk: bigint): void {
    const { levelSpacing } = this.config;

    const bestAsk = book.bestAsk();
    const bidTarget =
      bestAsk === undefined ? desiredBid : minBigInt(desiredBid, bestAsk - levelSpacing);
    if (bidTarget > 0n && book.quantityAt('bid', bidTarget) === 0n) {
      book.setLevel('bid', bidTarget, this.#randomLevelQuantity());
    }

    const bestBid = book.bestBid();
    const askTarget =
      bestBid === undefined ? desiredAsk : maxBigInt(desiredAsk, bestBid + levelSpacing);
    if (book.quantityAt('ask', askTarget) === 0n) {
      book.setLevel('ask', askTarget, this.#randomLevelQuantity());
    }
  }

  /**
   * Refills the visible ladder, walking **away from the mid** from the touch —
   * the replenishment rule in docs/02-market-domain.md §6. Levels further out
   * are larger, which is what gives the cumulative depth bars their shape.
   *
   * It fills every empty grid slot within the window rather than extending from
   * the far edge. Extending only outward leaves the ladder gappy: the touch
   * migrates with the fair value while the old cluster stays put, and the book
   * ends up as a lonely best level and a stale block a long way beneath it.
   * A reviewer spots that in five seconds, and the depth bars are meaningless.
   */
  #replenish(book: OrderBook, desiredBid: bigint, desiredAsk: bigint): void {
    const { levelSpacing } = this.config;

    for (const side of ['bid', 'ask'] as const) {
      const step = side === 'bid' ? -levelSpacing : levelSpacing;
      const touch = book.best(side) ?? (side === 'bid' ? desiredBid : desiredAsk);

      for (let offset = 0; offset < book.depth; offset += 1) {
        const price = touch + step * BigInt(offset);
        if (price <= 0n) break;
        if (book.quantityAt(side, price) !== 0n) continue;
        const scale = 1n + BigInt(Math.floor(offset / 8));
        book.setLevel(side, price, this.#randomLevelQuantity() * scale);
      }
    }
  }
}
