import type { Tier } from '@repo/protocol';
import { INITIAL_TIER } from '@repo/protocol';
import type { TierChangeReason } from '@repo/protocol';
import type { ConnectionSession } from './connection-session.js';

/**
 * Turns measured network reports into `autoTier`, with hysteresis.
 *
 * Smoothing is **not** done here. The client maintains the EWMA (α = 0.2) over
 * RTT and jitter and reports smoothed values; smoothing them again on the server
 * would distort the thresholds below, which are stated against the reported
 * numbers (docs/03-adaptive-delivery.md §4).
 *
 * The asymmetry is the whole point: demotion needs 3 confirming reports and
 * triggers on OR; promotion needs 5 and requires AND. Degrading is cheap and
 * reversible, promoting a client onto a link that cannot carry the rate is not.
 */

export interface TierTransition {
  readonly sustainedReports: number;
  readonly to: Tier;
  bad(rttMs: number, jitterMs: number): boolean;
  good(rttMs: number, jitterMs: number): boolean;
}

/** Thresholds from docs/03-adaptive-delivery.md §5. */
export const HYSTERESIS = Object.freeze({
  demoteReports: 3,
  promoteReports: 5,
  fullToDegraded: { rttMs: 150, jitterMs: 40 },
  degradedToFull: { rttMs: 100, jitterMs: 25 },
  degradedToMinimal: { rttMs: 350, jitterMs: 100 },
  minimalToDegraded: { rttMs: 250, jitterMs: 70 },
});

/** Missing-report ladder from docs/03-adaptive-delivery.md §6. */
export const MISSING_REPORT_MS = Object.freeze({
  demoteOneTier: 15_000,
  forceMinimal: 30_000,
});

const DEMOTE: Partial<Record<Tier, Tier>> = { full: 'degraded', degraded: 'minimal' };

export interface TierUpdate {
  readonly changed: boolean;
  readonly autoTier: Tier;
  readonly effectiveTier: Tier;
  readonly reason: TierChangeReason;
}

export class TierController {
  readonly #session: ConnectionSession;

  constructor(session: ConnectionSession) {
    this.#session = session;
    session.autoTier = INITIAL_TIER;
  }

  /** Folds one `network.report` in and returns whether the effective tier moved. */
  applyReport(rttMs: number, jitterMs: number, now: number): TierUpdate {
    const session = this.#session;
    const before = session.effectiveTier;

    session.rttMs = rttMs;
    session.jitterMs = jitterMs;
    session.lastNetworkReportAt = now;

    const bad = this.#isBad(session.autoTier, rttMs, jitterMs);
    const good = this.#isGood(session.autoTier, rttMs, jitterMs);

    // A report that confirms neither direction resets both counters — an
    // in-between link should not creep toward a promotion.
    session.consecutiveBadReports = bad ? session.consecutiveBadReports + 1 : 0;
    session.consecutiveGoodReports = good ? session.consecutiveGoodReports + 1 : 0;

    if (bad && session.consecutiveBadReports >= HYSTERESIS.demoteReports) {
      const next = DEMOTE[session.autoTier];
      if (next !== undefined) {
        session.autoTier = next;
        session.consecutiveBadReports = 0;
        session.consecutiveGoodReports = 0;
      }
    } else if (good && session.consecutiveGoodReports >= HYSTERESIS.promoteReports) {
      const next = session.autoTier === 'minimal' ? 'degraded' : 'full';
      if (next !== session.autoTier) {
        session.autoTier = next;
        session.consecutiveBadReports = 0;
        session.consecutiveGoodReports = 0;
      }
    }

    return this.#result(before, 'hysteresis');
  }

  /**
   * Applies the missing-report ladder. Silence is itself a signal: the link is
   * not carrying the client's own 5 s reports.
   */
  applySilence(now: number): TierUpdate {
    const session = this.#session;
    const before = session.effectiveTier;
    const since = session.lastNetworkReportAt ?? session.connectedAt;
    const silentMs = now - since;

    if (silentMs >= MISSING_REPORT_MS.forceMinimal) {
      session.autoTier = 'minimal';
    } else if (silentMs >= MISSING_REPORT_MS.demoteOneTier) {
      session.autoTier = DEMOTE[session.autoTier] ?? session.autoTier;
    }

    return this.#result(before, 'missing_reports');
  }

  /** `null` returns the connection to whatever `autoTier` is now — no re-warm-up. */
  setOverride(tier: Tier | null): TierUpdate {
    const before = this.#session.effectiveTier;
    this.#session.tierOverride = tier;
    return this.#result(before, 'override');
  }

  #result(before: Tier, reason: TierChangeReason): TierUpdate {
    const session = this.#session;
    return {
      changed: session.effectiveTier !== before,
      autoTier: session.autoTier,
      effectiveTier: session.effectiveTier,
      reason,
    };
  }

  #isBad(tier: Tier, rttMs: number, jitterMs: number): boolean {
    if (tier === 'full') {
      return (
        rttMs > HYSTERESIS.fullToDegraded.rttMs || jitterMs > HYSTERESIS.fullToDegraded.jitterMs
      );
    }
    if (tier === 'degraded') {
      return (
        rttMs > HYSTERESIS.degradedToMinimal.rttMs ||
        jitterMs > HYSTERESIS.degradedToMinimal.jitterMs
      );
    }
    return false;
  }

  #isGood(tier: Tier, rttMs: number, jitterMs: number): boolean {
    if (tier === 'degraded') {
      return (
        rttMs < HYSTERESIS.degradedToFull.rttMs && jitterMs < HYSTERESIS.degradedToFull.jitterMs
      );
    }
    if (tier === 'minimal') {
      return (
        rttMs < HYSTERESIS.minimalToDegraded.rttMs &&
        jitterMs < HYSTERESIS.minimalToDegraded.jitterMs
      );
    }
    return false;
  }
}
