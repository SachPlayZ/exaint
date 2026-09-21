'use client';

import type { MarketSummary, Tier } from '@repo/protocol';
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
    <header className="shrink-0 h-12 bg-surface/95 border border-line grid grid-cols-[auto_1fr_auto] md:grid-cols-[200px_1fr_auto] items-stretch">
      <div
        className="hidden md:flex items-center gap-2.5 px-3.5 border-r border-line"
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
        className="market-tape flex items-center justify-between gap-4 px-3.5 border-r border-line"
        aria-live="polite"
      >
        <div>
          <span className="text-[8px] text-muted-foreground tracking-widest block uppercase">
            MARKET / 01
          </span>
          <strong className="font-display font-extrabold text-sm md:text-base text-paper tracking-wide block mt-0.5">
            {props.market?.symbol ?? 'AWAITING MARKET'}
          </strong>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-display font-bold text-lg md:text-xl text-paper tracking-tight">
            {props.market !== null && props.latestPrice !== null
              ? `$${formatMarketPrice(props.latestPrice, props.market)}`
              : '—'}
          </span>
          <span
            className={cn(
              'text-xs font-bold font-mono',
              isPositive ? 'change-positive text-bid' : 'change-negative text-ask',
            )}
          >
            {isPositive ? '▲' : '▼'} {formatSessionChange(props.sessionChangeBps)}
            <small className="text-[8px] text-muted-foreground"> SESSION</small>
          </span>
        </div>
      </div>

      <div className="live-cluster flex items-center gap-2 px-3">
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
    </header>
  );
}
