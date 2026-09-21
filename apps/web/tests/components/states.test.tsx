import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderBookPanel } from '../../features/market/components/order-book-panel.js';
import { RecentTrades } from '../../features/market/components/recent-trades.js';
import { StaleBanner } from '../../features/market/components/stale-banner.js';
import { TerminalHeader } from '../../features/market/components/terminal-header.js';

describe('P11 honest empty and stale states', () => {
  it('keeps empty book and trade panels renderable without treating them as errors', () => {
    const book = renderToStaticMarkup(
      createElement(OrderBookPanel, {
        asks: [],
        bids: [],
        market: null,
        status: 'SYNCHRONIZED',
      }),
    );
    const trades = renderToStaticMarkup(createElement(RecentTrades, { market: null, trades: [] }));

    expect(book).toContain('WAITING FOR BOOK DEPTH');
    expect(book).toContain('SYNCHRONIZED');
    expect(trades).toContain('WAITING FOR EXECUTIONS');
    expect(trades).toContain('>00<');
  });

  it('reports reconnecting state and a monotonic last-live age without blanking data', () => {
    const banner = renderToStaticMarkup(
      createElement(StaleBanner, { ageMs: 4_200, connection: 'RECONNECTING' }),
    );

    expect(banner).toContain('RECONNECTING…');
    expect(banner).toContain('LAST LIVE UPDATE 4.2S AGO');
    expect(banner).toContain('role="status"');
  });

  it('keeps connection metrics available through the mobile header menu', () => {
    const header = renderToStaticMarkup(
      createElement(TerminalHeader, {
        connection: 'LIVE',
        effectiveTier: 'degraded',
        latestPrice: 2_151_660n,
        market: {
          symbol: 'SOL-USD',
          priceScale: 4,
          quantityScale: 8,
          tickSize: '0.0100',
          bookDepth: 25,
        },
        rttMs: 42,
        sessionChangeBps: 6n,
      }),
    );

    expect(header).toContain('mobile-header-menu');
    expect(header).toContain('aria-label="Open connection menu"');
    expect(header).toContain('42 MS');
    expect(header).toContain('DEGRADED');
  });
});
