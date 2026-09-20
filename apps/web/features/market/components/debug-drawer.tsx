'use client';

import type { Tier } from '@repo/protocol';
import type { ConnectionState } from '../socket/types';
import { formatRate } from './format';

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
    <details className="debug-drawer panel">
      <summary>
        <span>
          <span className="eyebrow">SYSTEM / INSPECTOR</span>
          <strong>NETWORK &amp; DELIVERY</strong>
        </span>
        <span className="debug-summary-rate">
          {formatRate(props.candleActualHz)} / {formatRate(props.tradeActualHz)} HZ
        </span>
      </summary>
      <div className="debug-grid">
        <div className="debug-section">
          <h3>CONNECTION</h3>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{props.connection}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>{props.connectionId?.slice(0, 8) ?? '—'}</dd>
            </div>
            <div>
              <dt>Symbol</dt>
              <dd>{props.symbol ?? '—'}</dd>
            </div>
            <div>
              <dt>Book seq</dt>
              <dd>{props.lastBookSequence ?? '—'}</dd>
            </div>
            <div>
              <dt>Trade id</dt>
              <dd>{props.lastTradeId ?? '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="debug-section">
          <h3>NETWORK</h3>
          <dl>
            <div>
              <dt>RTT</dt>
              <dd>{Math.round(props.rttMs)} ms</dd>
            </div>
            <div>
              <dt>Jitter</dt>
              <dd>{Math.round(props.jitterMs)} ms</dd>
            </div>
          </dl>
        </div>
        <div className="debug-section debug-adaptive">
          <h3>ADAPTIVE DELIVERY</h3>
          <dl>
            <div>
              <dt>Auto tier</dt>
              <dd>{props.autoTier.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Override</dt>
              <dd>{props.override?.toUpperCase() ?? 'OFF'}</dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>{props.effectiveTier.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Candles</dt>
              <dd>
                {formatRate(1_000 / props.candleTargetMs)} target /{' '}
                {formatRate(props.candleActualHz)} actual Hz
              </dd>
            </div>
            <div>
              <dt>Trades</dt>
              <dd>
                {formatRate(1_000 / props.tradeTargetMs)} target / {formatRate(props.tradeActualHz)}{' '}
                actual Hz
              </dd>
            </div>
          </dl>
          <div className="override-controls" aria-label="Delivery tier override">
            {OVERRIDES.map((item) => (
              <button
                className={props.override === item.value ? 'active' : ''}
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
