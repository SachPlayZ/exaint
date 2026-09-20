'use client';

import type { Tier } from '@repo/protocol';
import { create } from 'zustand';
import type { ConnectionState } from '../socket/types.js';

/**
 * Realtime application state (docs/04-frontend.md §8).
 *
 * Zustand, not Redux, and deliberately small: it holds the handful of values the
 * chrome renders. Per-packet market data lives in the domain models and reaches
 * the UI through a snapshot published once per frame — it never passes through
 * here, or React would re-render on every packet.
 */
export interface ConnectionStoreState {
  connection: ConnectionState;
  /** Server-measured. The client never picks its own automatic tier. */
  autoTier: Tier;
  tierOverride: Tier | null;
  effectiveTier: Tier;
  candlesUpdateMs: number;
  tradesBatchMs: number;
  rttMs: number;
  jitterMs: number;
  connectionId: string | null;
  /** `performance.now()` of the last frame — what the STALE badge counts from. */
  lastFrameAt: number | null;

  setConnection(state: ConnectionState): void;
  setTier(update: {
    autoTier: Tier;
    tierOverride: Tier | null;
    effectiveTier: Tier;
    candlesUpdateMs: number;
    tradesBatchMs: number;
  }): void;
  setLatency(rttMs: number, jitterMs: number): void;
  setConnectionId(connectionId: string | null): void;
  markFrame(at: number): void;
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  connection: 'CONNECTING',
  autoTier: 'degraded',
  tierOverride: null,
  effectiveTier: 'degraded',
  candlesUpdateMs: 500,
  tradesBatchMs: 500,
  rttMs: 0,
  jitterMs: 0,
  connectionId: null,
  lastFrameAt: null,

  setConnection: (connection) => set({ connection }),
  setTier: (update) => set(update),
  setLatency: (rttMs, jitterMs) => set({ rttMs, jitterMs }),
  setConnectionId: (connectionId) => set({ connectionId }),
  markFrame: (at) => set({ lastFrameAt: at }),
}));
