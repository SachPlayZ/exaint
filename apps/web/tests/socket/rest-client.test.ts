import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketRestClient, RestError } from '../../features/market/api/rest-client.js';
import { queryKeys } from '../../features/market/api/query-keys.js';

const client = new MarketRestClient('http://api.test/');

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MarketRestClient', () => {
  it('parses a valid response with the shared schema', async () => {
    mockFetch(200, {
      serverTime: 1_700_000_000_000,
      symbols: [
        { symbol: 'BTC-USD', priceScale: 4, quantityScale: 8, tickSize: '0.1000', bookDepth: 25 },
      ],
    });
    const markets = await client.fetchMarkets();
    expect(markets.symbols[0]?.symbol).toBe('BTC-USD');
  });

  it('rejects a response that does not match the contract', async () => {
    mockFetch(200, { serverTime: 'yesterday', symbols: [] });
    await expect(client.fetchMarkets()).rejects.toBeInstanceOf(RestError);
  });

  it('surfaces the documented error code from a failure body', async () => {
    mockFetch(404, { code: 'UNKNOWN_SYMBOL' });
    await expect(client.fetchBookSnapshot('DOGE-USD')).rejects.toMatchObject({
      status: 404,
      code: 'UNKNOWN_SYMBOL',
    });
  });

  it('accepts an empty candle history as a valid state', async () => {
    mockFetch(200, {
      symbol: 'BTC-USD',
      interval: '1s',
      serverTime: 1_700_000_000_000,
      candles: [],
    });
    await expect(client.fetchCandles('BTC-USD', '1s', 300)).resolves.toMatchObject({
      candles: [],
    });
  });

  it('builds URLs that encode the symbol and carry both query params', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ symbol: 'BTC-USD', interval: '1s', serverTime: 1, candles: [] }),
      };
    });
    await client.fetchCandles('BTC-USD', '1s', 42);
    expect(urls).toEqual(['http://api.test/v1/markets/BTC-USD/candles?interval=1s&limit=42']);
  });
});

describe('query keys', () => {
  it('include both symbol and interval, so a switch cancels the old request', () => {
    expect(queryKeys.candles('BTC-USD', '1s', 300)).toEqual(['candles', 'BTC-USD', '1s', 300]);
    expect(queryKeys.candles('BTC-USD', '1s', 300)).not.toEqual(
      queryKeys.candles('BTC-USD', '1m', 300),
    );
    expect(queryKeys.candles('BTC-USD', '1s', 300)).not.toEqual(
      queryKeys.candles('ETH-USD', '1s', 300),
    );
    expect(queryKeys.book('BTC-USD')).not.toEqual(queryKeys.book('ETH-USD'));
  });
});
