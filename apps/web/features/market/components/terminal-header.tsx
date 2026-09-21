'use client';

import type { MarketSummary, Tier } from '@repo/protocol';
import { Menu } from 'lucide-react';
import type { ConnectionState } from '../socket/types';
import { formatMarketPrice, formatSessionChange } from './format';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TerminalHeaderProps {
  readonly market: MarketSummary | null;
  readonly latestPrice: bigint | null;
  readonly sessionChangeBps: bigint | null;
  readonly connection: ConnectionState;
  readonly rttMs: number;
  readonly effectiveTier: Tier;
}

export function TerminalHeader(props: TerminalHeaderProps) {
  const isPositive = (props.sessionChangeBps ?? 0n) >= 0n;
  const isLive = props.connection === 'LIVE';
  const isStale =
    props.connection === 'STALE' ||
    props.connection === 'RECONNECTING' ||
    props.connection === 'ERROR';

  return (
    <header className="relative z-20 shrink-0 h-12 bg-surface/95 border border-line grid grid-cols-[minmax(0,1fr)_44px] lg:grid-cols-[200px_minmax(0,1fr)_auto] items-stretch">
      <div
        className="hidden lg:flex items-center gap-2.5 px-3.5 border-r border-line"
        aria-label="Exaint terminal"
      >
        <span className="size-8 bg-signal text-ink font-display font-black text-sm flex items-center justify-center -skew-x-6 shrink-0">
          EX
        </span>
        <div className="flex flex-col leading-none">
          <strong className="font-display font-extrabold text-sm text-paper tracking-wider">
            EXAINT
          </strong>
          <small className="text-[8px] text-muted-foreground tracking-widest mt-0.5">
            ADAPTIVE TERMINAL
          </small>
        </div>
      </div>

      <div
        className="market-tape min-w-0 flex items-center justify-between gap-2 px-2.5 sm:gap-4 sm:px-3.5 border-r border-line"
        aria-live="polite"
      >
        <div className="min-w-0">
          <span className="text-[8px] text-muted-foreground tracking-widest block uppercase">
            MARKET / 01
          </span>
          <strong className="font-display font-extrabold text-sm lg:text-base text-paper tracking-wide block mt-0.5 truncate">
            {props.market?.symbol ?? 'AWAITING MARKET'}
          </strong>
        </div>
        <div className="min-w-0 flex items-baseline justify-end gap-1.5 sm:gap-3">
          <span className="font-display font-bold text-base sm:text-lg lg:text-xl text-paper tracking-tight whitespace-nowrap">
            {props.market !== null && props.latestPrice !== null
              ? `$${formatMarketPrice(props.latestPrice, props.market)}`
              : '—'}
          </span>
          <span
            className={cn(
              'hidden min-[420px]:inline text-[10px] sm:text-xs font-bold font-mono whitespace-nowrap',
              isPositive ? 'change-positive text-bid' : 'change-negative text-ask',
            )}
          >
            {isPositive ? '▲' : '▼'} {formatSessionChange(props.sessionChangeBps)}
            <small className="text-[8px] text-muted-foreground"> SESSION</small>
          </span>
        </div>
      </div>

      <div className="live-cluster hidden lg:flex items-center gap-2 px-3">
        <Badge
          variant="outline"
          className={cn(
            'status-pill h-7 px-2.5 rounded-full border-line text-[10px] font-mono tracking-wider font-semibold',
            `status-${props.connection.toLowerCase()}`,
            isLive && 'text-signal border-signal/40 bg-signal/5',
            isStale && 'text-ask border-ask/40 bg-ask/5',
            !isLive && !isStale && 'text-amber border-amber/40 bg-amber/5',
          )}
        >
          <i
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full mr-1.5 inline-block',
              isLive && 'bg-signal shadow-[0_0_6px_var(--signal)]',
              isStale && 'bg-ask shadow-[0_0_6px_var(--ask)]',
              !isLive && !isStale && 'bg-amber shadow-[0_0_6px_var(--amber)]',
            )}
          />
          {props.connection}
        </Badge>
        <Badge
          variant="outline"
          className="metric-chip h-7 px-2 rounded border-line text-[10px] font-mono text-paper hidden sm:inline-flex"
        >
          <small className="text-muted-foreground mr-1">RTT</small> {Math.round(props.rttMs)}MS
        </Badge>
        <Badge
          variant="outline"
          className="metric-chip tier-chip h-7 px-2 rounded border-line text-[10px] font-mono text-signal"
        >
          <small className="text-muted-foreground mr-1">TIER</small>{' '}
          {props.effectiveTier.toUpperCase()}
        </Badge>
      </div>

      <details className="mobile-header-menu group relative lg:hidden">
        <summary
          aria-label="Open connection menu"
          className="h-full min-h-11 grid place-items-center list-none cursor-pointer text-muted-foreground hover:text-signal hover:bg-white/[0.03] transition-colors [&::-webkit-details-marker]:hidden"
        >
          <Menu aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </summary>
        <div className="absolute right-0 top-full mt-1 z-50 w-[min(17rem,calc(100vw-1rem))] border border-line bg-surface-raised shadow-[0_14px_40px_rgba(0,0,0,0.5)] p-3 text-[10px] font-mono">
          <div className="flex items-center justify-between border-b border-line pb-2 mb-2">
            <span className="text-[8px] text-muted-foreground tracking-widest uppercase">
              Connection
            </span>
            <strong
              className={cn(
                'mobile-status tracking-wider',
                isLive && 'text-signal',
                isStale && 'text-ask',
                !isLive && !isStale && 'text-amber',
              )}
            >
              {props.connection}
            </strong>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2">
            <dt className="text-muted-foreground">RTT</dt>
            <dd className="text-right text-paper">{Math.round(props.rttMs)} MS</dd>
            <dt className="text-muted-foreground">Effective tier</dt>
            <dd className="text-right text-signal font-semibold">
              {props.effectiveTier.toUpperCase()}
            </dd>
          </dl>
        </div>
      </details>
    </header>
  );
}
