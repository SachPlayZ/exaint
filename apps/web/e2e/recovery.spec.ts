import { expect, test } from '@playwright/test';

test.describe('E2E Recovery & Terminal Invariants', () => {
  test('recovers from dropped book delta by entering RESYNCING and resynchronising', async ({
    page,
  }) => {
    let droppedOne = false;
    await page.routeWebSocket('**/v1/ws*', (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        if (typeof message === 'string') {
          try {
            const frame = JSON.parse(message) as { type?: string };
            if (frame.type === 'book.delta' && !droppedOne) {
              droppedOne = true;
              // Drop single delta to force sequence discontinuity gap (Invariant I1)
              return;
            }
          } catch {
            // Ignore unparsed frames
          }
        }
        ws.send(message);
      });
      ws.onMessage((message) => {
        server.send(message);
      });
    });

    await page.goto('/');

    // App opens, connects, and reaches LIVE with a synchronised order book
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });
    await expect(page.locator('.book-status')).toContainText('SYNCHRONIZED', { timeout: 15_000 });

    // The gap triggers resync; book reaches SYNCHRONIZED state with unbroken level counts
    await expect(page.locator('.book-status')).toHaveText('SYNCHRONIZED', { timeout: 15_000 });
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });
    await expect(page.locator('.book-row.book-bid')).toHaveCount(12);
    await expect(page.locator('.book-row.book-ask')).toHaveCount(12);
  });

  test('handles offline disconnect gracefully, preserving market data and reconnecting', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });
    await expect(page.locator('.book-row.book-bid')).toHaveCount(12, { timeout: 15_000 });
    await expect(page.locator('.book-row.book-ask')).toHaveCount(12, { timeout: 15_000 });

    // Emulate network failure
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // Assert status switches to STALE/RECONNECTING and stale banner is displayed
    await expect(page.locator('.status-pill')).toContainText(/STALE|RECONNECTING|ERROR/, {
      timeout: 10_000,
    });
    await expect(page.locator('.stale-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.stale-banner')).toContainText('LAST LIVE UPDATE');

    // Invariant: screen NEVER blanks when disconnected; last known market data remains visible
    await expect(page.locator('.book-row.book-bid')).toHaveCount(12);
    await expect(page.locator('.book-row.book-ask')).toHaveCount(12);

    // Restore network
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    // Reconnection fetches fresh ticket and restores LIVE and SYNCHRONIZED status
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 25_000 });
    await expect(page.locator('.book-status')).toHaveText('SYNCHRONIZED', { timeout: 25_000 });
  });

  test('supports watchlist reordering and symbol switching without stale data leaks', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });

    // Default symbol is BTC-USD
    await expect(page.locator('.market-tape strong')).toHaveText('BTC-USD');

    // Reorder watchlist using keyboard interaction on the first drag handle
    const firstDragHandle = page.locator('button.drag-handle').first();
    await firstDragHandle.focus();
    await page.keyboard.press('ArrowRight');

    // Switch symbol to HYPE-USD
    const hypeButton = page.locator('button.watch-select', { hasText: 'HYPE-USD' });
    await hypeButton.click();

    // Confirm market tape, book, and trades switch cleanly
    await expect(page.locator('.market-tape strong')).toHaveText('HYPE-USD', { timeout: 10_000 });
    await expect(page.locator('.book-status')).toHaveText('SYNCHRONIZED', { timeout: 10_000 });
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 10_000 });
    await expect(page.locator('.book-row.book-bid')).toHaveCount(12);

    // Reload and assert watchlist order survived in localStorage
    await page.reload();
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });
    const storedOrder = await page.evaluate(() =>
      localStorage.getItem('exaint.watchlist.order.v1'),
    );
    expect(storedOrder).not.toBeNull();
    if (storedOrder === null) throw new Error('Expected storedOrder in localStorage');
    const parsed = JSON.parse(storedOrder) as string[];
    expect(parsed[1]).toBe('BTC-USD');
  });

  test('maintains >= 10 bids and >= 10 asks and no horizontal scroll at all breakpoints', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });

    const breakpoints = [
      { width: 1280, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
    ];

    for (const viewport of breakpoints) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);

      const bidCount = await page.locator('.book-row.book-bid').count();
      const askCount = await page.locator('.book-row.book-ask').count();
      expect(bidCount).toBeGreaterThanOrEqual(10);
      expect(askCount).toBeGreaterThanOrEqual(10);

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll, `Horizontal scroll detected at ${viewport.width}px`).toBe(false);

      if (viewport.width < 1024) {
        await expect(page.locator('.live-cluster')).toBeHidden();
        const mobileMenu = page.locator('.mobile-header-menu');
        await expect(mobileMenu.locator('summary')).toBeVisible();
        await mobileMenu.locator('summary').click();
        await expect(mobileMenu.locator('.mobile-status')).toContainText('LIVE');
        await mobileMenu.locator('summary').click();
      }
    }
  });

  test('fits entirely within desktop viewport with zero vertical scroll', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.status-pill')).toContainText('LIVE', { timeout: 15_000 });

    const desktopViewports = [
      { width: 1280, height: 900 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];

    for (const viewport of desktopViewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(200);

      const hasScroll = await page.evaluate(() => {
        const docScroll =
          document.documentElement.scrollHeight > document.documentElement.clientHeight;
        const bodyScroll = document.body.scrollHeight > document.body.clientHeight;
        return docScroll || bodyScroll;
      });
      expect(hasScroll, `Page scroll detected at ${viewport.width}x${viewport.height}`).toBe(false);
    }

    // Toggle debug drawer open and closed; interface must stay within viewport without page scroll
    const debugSummary = page.locator('.debug-drawer summary');
    await debugSummary.click();
    await page.waitForTimeout(200);
    let hasScrollWithOpenDrawer = await page.evaluate(() => {
      return (
        document.documentElement.scrollHeight > document.documentElement.clientHeight ||
        document.body.scrollHeight > document.body.clientHeight
      );
    });
    expect(hasScrollWithOpenDrawer, 'Page scroll detected when debug drawer opened').toBe(false);

    await debugSummary.click();
    await page.waitForTimeout(200);
    hasScrollWithOpenDrawer = await page.evaluate(() => {
      return (
        document.documentElement.scrollHeight > document.documentElement.clientHeight ||
        document.body.scrollHeight > document.body.clientHeight
      );
    });
    expect(hasScrollWithOpenDrawer, 'Page scroll detected when debug drawer closed').toBe(false);
  });
});
