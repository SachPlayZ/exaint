'use client';

import type { Candle, Interval, MarketSummary, Tier } from '@repo/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRestClient, useMarkets } from '../api/queries';
import { ChartPanel } from '../components/chart-panel';
import { DebugDrawer } from '../components/debug-drawer';
import { OrderBookPanel } from '../components/order-book-panel';
import { RecentTrades } from '../components/recent-trades';
import { StaleBanner } from '../components/stale-banner';
import { TerminalHeader } from '../components/terminal-header';
import { Watchlist } from '../components/watchlist';
import {
  DEFAULT_CHART_INTERVAL,
  TerminalRuntime,
  type TerminalRuntimeSnapshot,
} from '../runtime/terminal-runtime';
import { useConnectionStore } from '../stores/connection-store';
import { cn } from '@/lib/utils';

function useRuntimeSnapshot(runtime: TerminalRuntime | null): TerminalRuntimeSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => runtime?.subscribe(listener) ?? (() => undefined),
    [runtime],
  );
  const getSnapshot = useCallback(() => runtime?.getSnapshot() ?? null, [runtime]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function LoadingTerminal({ error }: { readonly error?: string }) {
  return (
    <main className="min-h-screen grid place-content-center justify-items-center gap-4 text-muted-foreground text-[10px] tracking-widest font-mono">
      <span className="size-8 bg-signal text-ink font-display font-black text-sm flex items-center justify-center -skew-x-6">
        EX
      </span>
      <p>{error ?? 'ESTABLISHING MARKET REGISTRY'}</p>
      <i className="w-36 h-px bg-line overflow-hidden relative after:block after:w-2/5 after:h-full after:bg-signal after:animate-[scan_1.2s_ease-in-out_infinite]" />
    </main>
  );
}

export function TradingTerminal() {
  const queryClient = useQueryClient();
  const restClient = useMemo(() => createRestClient(), []);
  const marketsQuery = useMarkets(restClient);
  const [runtime, setRuntime] = useState<TerminalRuntime | null>(null);
  const runtimeRef = useRef<TerminalRuntime | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const snapshot = useRuntimeSnapshot(runtime);

  const connection = useConnectionStore((state) => state.connection);
  const connectionId = useConnectionStore((state) => state.connectionId);
  const rttMs = useConnectionStore((state) => state.rttMs);
  const jitterMs = useConnectionStore((state) => state.jitterMs);
  const autoTier = useConnectionStore((state) => state.autoTier);
  const tierOverride = useConnectionStore((state) => state.tierOverride);
  const effectiveTier = useConnectionStore((state) => state.effectiveTier);
  const candlesUpdateMs = useConnectionStore((state) => state.candlesUpdateMs);
  const tradesBatchMs = useConnectionStore((state) => state.tradesBatchMs);

  const markets = useMemo(() => marketsQuery.data?.symbols ?? [], [marketsQuery.data]);
  const mountChart = useCallback(
    (container: HTMLDivElement | null): void => {
      if (container === null) {
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        return;
      }
      if (runtimeRef.current !== null) return;
      const initialMarket = markets[0];
      if (initialMarket === undefined) return;
      const created = new TerminalRuntime({
        markets,
        initialMarket,
        container,
        queryClient,
        restClient,
        wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080/v1/ws',
        onHoverChange: (value) => setHover(value?.candle ?? null),
      });
      runtimeRef.current = created;
      setRuntime(created);
      created.start();
    },
    [markets, queryClient, restClient],
  );

  if (marketsQuery.isError) return <LoadingTerminal error="MARKET REGISTRY UNAVAILABLE" />;
  if (markets.length === 0) return <LoadingTerminal />;

  const selectedMarket = snapshot?.market ?? markets[0] ?? null;
  const selectedSymbol = selectedMarket?.symbol ?? null;

  const selectMarket = (market: MarketSummary): void => {
    setHover(null);
    runtime?.selectMarket(market);
  };
  const selectInterval = (interval: Interval): void => {
    setHover(null);
    runtime?.selectInterval(interval);
  };
  const setOverride = (tier: Tier | null): void => runtime?.setTierOverride(tier);
  const stale = connection === 'STALE' || connection === 'RECONNECTING' || connection === 'ERROR';

  return (
    <main className="relative h-screen max-h-screen w-full flex flex-col overflow-hidden p-2 bg-ink text-paper font-mono select-none">
      {/* Top neon glow bar */}
      <div className="fixed inset-x-0 top-0 h-0.5 z-20 bg-signal shadow-[0_0_24px_rgba(185,255,66,0.5)] pointer-events-none" />

      <TerminalHeader
        connection={connection}
        effectiveTier={effectiveTier}
        latestPrice={snapshot?.latestPriceFixed ?? null}
        market={selectedMarket}
        rttMs={rttMs}
        sessionChangeBps={snapshot?.sessionChangeBps ?? null}
      />
      {stale ? (
        <StaleBanner ageMs={snapshot?.lastLiveAgeMs ?? null} connection={connection} />
      ) : null}
      <Watchlist markets={markets} onSelect={selectMarket} selectedSymbol={selectedSymbol} />

      <div
        className={cn(
          'flex-1 min-h-0 w-full flex flex-col md:grid md:grid-cols-2 xl:flex xl:flex-row gap-1.5 overflow-y-auto md:overflow-hidden transition-[filter]',
          stale && 'saturate-[0.55]',
        )}
      >
        <div className="contents xl:flex xl:flex-col xl:flex-1 xl:min-w-0 xl:min-h-0 xl:gap-1.5">
          <ChartPanel
            hover={hover}
            interval={snapshot?.interval ?? DEFAULT_CHART_INTERVAL}
            market={selectedMarket}
            onContainer={mountChart}
            onIntervalChange={selectInterval}
            waiting={snapshot?.waitingForCandles ?? true}
          />
          <DebugDrawer
            autoTier={autoTier}
            candleActualHz={snapshot?.candleActualHz ?? 0}
            candleTargetMs={candlesUpdateMs}
            connection={connection}
            connectionId={connectionId}
            effectiveTier={effectiveTier}
            jitterMs={jitterMs}
            lastBookSequence={snapshot?.lastBookSequence ?? null}
            lastTradeId={snapshot?.lastTradeId ?? null}
            onOverride={setOverride}
            override={tierOverride}
            rttMs={rttMs}
            symbol={selectedSymbol}
            tradeActualHz={snapshot?.tradeActualHz ?? 0}
            tradeTargetMs={tradesBatchMs}
          />
        </div>
        <div className="contents xl:flex xl:flex-col xl:w-[380px] xl:shrink-0 xl:min-h-0 xl:gap-1.5">
          <OrderBookPanel
            asks={snapshot?.asks ?? []}
            bids={snapshot?.bids ?? []}
            market={selectedMarket}
            status={snapshot?.bookStatus ?? 'IDLE'}
          />
          <RecentTrades market={selectedMarket} trades={snapshot?.recentTrades ?? []} />
        </div>
      </div>
      <footer className="shrink-0 h-6 px-3 hidden md:flex items-center justify-between border border-line bg-surface/95 text-[8.5px] text-muted-foreground tracking-wider mt-1">
        <span>CANONICAL ENGINE / SEED 1337</span>
        <span>ORDERING BY IDENTIFIER — NEVER TIMESTAMP</span>
        <span>LOGICAL CLOCK / 50MS</span>
      </footer>
    </main>
  );
}
