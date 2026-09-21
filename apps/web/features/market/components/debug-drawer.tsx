'use client';

import type { Tier } from '@repo/protocol';
import type { ConnectionState } from '../socket/types';
import { formatRate } from './format';
import { cn } from '@/lib/utils';

const OVERRIDES: readonly { readonly label: string; readonly value: Tier | null }[] = [
  { label: 'Auto', value: null },
  { label: 'Full', value: 'full' },
  { label: 'Degraded', value: 'degraded' },
  { label: 'Minimal', value: 'minimal' },
];

export interface DebugDrawerProps {
  readonly connection: ConnectionState;
  readonly connectionId: string | null;
  readonly symbol: string | null;
  readonly lastBookSequence: string | null;
  readonly lastTradeId: string | null;
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly autoTier: Tier;
  readonly override: Tier | null;
  readonly effectiveTier: Tier;
  readonly candleTargetMs: number;
  readonly tradeTargetMs: number;
  readonly candleActualHz: number;
  readonly tradeActualHz: number;
  readonly onOverride: (tier: Tier | null) => void;
}

export function DebugDrawer(props: DebugDrawerProps) {
  return (
    <details className="debug-drawer md:col-span-2 shrink-0 flex flex-col bg-surface/95 border border-line overflow-hidden group">
      <summary className="shrink-0 h-10 px-3 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.02] list-none transition-colors">
        <div>
          <span className="text-[8px] text-muted-foreground tracking-widest uppercase block">
            SYSTEM / INSPECTOR
          </span>
          <strong className="font-display font-extrabold text-xs text-paper tracking-wide block leading-none mt-0.5">
            NETWORK &amp; DELIVERY
          </strong>
        </div>
        <span className="text-[9px] font-mono text-signal">
          {formatRate(props.candleActualHz)} / {formatRate(props.tradeActualHz)} HZ
        </span>
      </summary>
      <div className="border-t border-line grid grid-cols-1 md:grid-cols-3 text-[8.5px] font-mono">
        <div className="p-2.5 md:border-r border-line">
          <h3 className="text-[8px] text-muted-foreground tracking-widest uppercase mb-1.5 font-bold">
            CONNECTION
          </h3>
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-paper">{props.connection}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Connection</dt>
              <dd className="text-paper">{props.connectionId?.slice(0, 8) ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Symbol</dt>
              <dd className="text-paper">{props.symbol ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Book seq</dt>
              <dd className="text-paper">{props.lastBookSequence ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Trade id</dt>
              <dd className="text-paper">{props.lastTradeId ?? '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="p-2.5 md:border-r border-line border-t md:border-t-0">
          <h3 className="text-[8px] text-muted-foreground tracking-widest uppercase mb-1.5 font-bold">
            NETWORK
          </h3>
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">RTT</dt>
              <dd className="text-paper">{Math.round(props.rttMs)} ms</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Jitter</dt>
              <dd className="text-paper">{Math.round(props.jitterMs)} ms</dd>
            </div>
          </dl>
        </div>
        <div className="p-2.5 border-t md:border-t-0">
          <h3 className="text-[8px] text-muted-foreground tracking-widest uppercase mb-1.5 font-bold">
            ADAPTIVE DELIVERY
          </h3>
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Auto tier</dt>
              <dd className="text-signal font-semibold">{props.autoTier.toUpperCase()}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Override</dt>
              <dd className="text-paper">{props.override?.toUpperCase() ?? 'OFF'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Effective</dt>
              <dd className="text-signal font-semibold">{props.effectiveTier.toUpperCase()}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Candles</dt>
              <dd className="text-paper">
                {formatRate(1_000 / props.candleTargetMs)} tgt / {formatRate(props.candleActualHz)}{' '}
                Hz
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Trades</dt>
              <dd className="text-paper">
                {formatRate(1_000 / props.tradeTargetMs)} tgt / {formatRate(props.tradeActualHz)} Hz
              </dd>
            </div>
          </dl>
          <div
            className="mt-2 flex border border-line rounded overflow-hidden"
            aria-label="Delivery tier override"
          >
            {OVERRIDES.map((item) => (
              <button
                className={cn(
                  'flex-1 h-5.5 px-1.5 text-[8px] font-mono border-r border-line last:border-r-0 transition-colors cursor-pointer',
                  props.override === item.value
                    ? 'active bg-signal text-ink font-bold'
                    : 'text-muted-foreground hover:text-paper hover:bg-white/[0.03]',
                )}
                key={item.label}
                onClick={() => props.onOverride(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
