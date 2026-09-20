import type { Trade } from '@repo/protocol';
import { describe, expect, it } from 'vitest';
import { MarketUiModel } from '../../features/market/model/market-ui-model.js';

const trade = (
  symbol: string,
  tradeId: string,
  price = `${tradeId}.0000`,
  timestamp = Number(tradeId),
): Trade => ({
  type: 'trade',
  symbol,
  tradeId,
  timestamp,
  side: 'buy',
  price,
  quantity: '1.00000000',
});

describe('MarketUiModel', () => {
  it('orders numerically, ignores duplicates, and never uses timestamps or arrival order', () => {
    const model = new MarketUiModel('BTC-USD');

    model.processTrades([
      trade('BTC-USD', '9', '9.0000', 900),
      trade('BTC-USD', '10', '10.0000', 100),
      trade('BTC-USD', '8', '8.0000', 1_000),
      trade('BTC-USD', '10', '999.0000', 2_000),
    ]);

    const first = model.snapshot();
    expect(first.recentTrades.map(({ tradeId }) => tradeId)).toEqual(['10', '9', '8']);
    expect(first.latestPrice).toBe('10.0000');
    expect(first.sessionBaselinePrice).toBe('8.0000');
    expect(first.lastTradeId).toBe('10');

    model.processTrades([trade('BTC-USD', '7', '7.0000', 3_000)]);
    expect(model.snapshot().sessionBaselinePrice).toBe('8.0000');
  });

  it('caps recent trades at 50 newest identifiers', () => {
    const model = new MarketUiModel('BTC-USD');
    const trades = Array.from({ length: 60 }, (_, index) => trade('BTC-USD', String(index + 1)));

    model.processTrades(trades.reverse());

    const snapshot = model.snapshot();
    expect(snapshot.recentTrades).toHaveLength(50);
    expect(snapshot.recentTrades[0]?.tradeId).toBe('60');
    expect(snapshot.recentTrades[49]?.tradeId).toBe('11');
  });

  it('keeps identifier state scoped per symbol and snapshots the selection', () => {
    const model = new MarketUiModel('BTC-USD');
    model.processTrades([trade('BTC-USD', '2', '100.0000'), trade('SOL-USD', '2', '20.0000')]);

    expect(model.snapshot().latestPrice).toBe('100.0000');

    model.selectSymbol('SOL-USD');
    const sol = model.snapshot({
      bids: [{ price: 200_000n, quantity: 10n, cumulative: 10n }],
      asks: [{ price: 200_001n, quantity: 20n, cumulative: 20n }],
    });
    expect(sol.latestPrice).toBe('20.0000');
    expect(sol.lastTradeId).toBe('2');
    expect(sol.bids[0]?.price).toBe(200_000n);
    expect(Object.isFrozen(sol)).toBe(true);
    expect(Object.isFrozen(sol.recentTrades)).toBe(true);
    expect(Object.isFrozen(sol.bids[0])).toBe(true);
  });
});
