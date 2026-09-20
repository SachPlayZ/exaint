'use client';

import type { MarketSummary, Tier } from '@repo/protocol';
import type { ConnectionState } from '../socket/types';
import { formatMarketPrice, formatSessionChange } from './format';

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
  return (
    <header className="terminal-header">
      <div className="brand-lockup" aria-label="Exaint terminal">
        <span className="brand-mark">EX</span>
        <span>
          <strong>EXAINT</strong>
          <small>ADAPTIVE MARKET TERMINAL</small>
        </span>
      </div>

      <div className="market-tape" aria-live="polite">
        <div>
          <span className="eyebrow">MARKET / 01</span>
          <strong>{props.market?.symbol ?? 'AWAITING MARKET'}</strong>
        </div>
        <div className="price-block">
          <span className="market-price">
            {props.market !== null && props.latestPrice !== null
              ? `$${formatMarketPrice(props.latestPrice, props.market)}`
              : '—'}
          </span>
          <span className={isPositive ? 'change-positive' : 'change-negative'}>
            {isPositive ? '▲' : '▼'} {formatSessionChange(props.sessionChangeBps)}
            <small> SESSION</small>
          </span>
        </div>
      </div>

      <div className="live-cluster">
        <span className={`status-pill status-${props.connection.toLowerCase()}`}>
          <i aria-hidden="true" /> {props.connection}
        </span>
        <span className="metric-chip">
          <small>RTT</small> {Math.round(props.rttMs)}MS
        </span>
        <span className="metric-chip tier-chip">
          <small>TIER</small> {props.effectiveTier.toUpperCase()}
        </span>
      </div>
    </header>
  );
}
