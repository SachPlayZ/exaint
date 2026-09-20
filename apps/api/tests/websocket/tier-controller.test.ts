import { describe, expect, it } from 'vitest';
import { INITIAL_TIER, type Tier } from '@repo/protocol';
import { ConnectionSession } from '../../src/websocket/connection-session.js';
import { ConnectionRateLimiter } from '../../src/websocket/rate-limiter.js';
import {
  HYSTERESIS,
  MISSING_REPORT_MS,
  TierController,
} from '../../src/websocket/tier-controller.js';

const START = 1_700_000_000_000;

/** T1 — tier hysteresis. Fake clock throughout; never real timers. */
function build(): { session: ConnectionSession; controller: TierController } {
  const session = new ConnectionSession({
    connectionId: 'test',
    subject: 'anon-test',
    rateLimiter: new ConnectionRateLimiter({ globalPerSecond: 20, strikeLimit: 3 }),
    maxSubscriptions: 5,
    now: START,
  });
  return { session, controller: new TierController(session) };
}

const GOOD = { rttMs: 40, jitterMs: 5 };
const BAD_FOR_FULL = { rttMs: 200, jitterMs: 10 };
const BAD_FOR_DEGRADED = { rttMs: 400, jitterMs: 10 };

describe('TierController (T1)', () => {
  it('starts DEGRADED — we know nothing about this link yet', () => {
    const { session } = build();
    expect(session.autoTier).toBe(INITIAL_TIER);
    expect(session.autoTier).toBe('degraded');
  });

  it('promotes slowly: five consecutive good reports, not four', () => {
    const { session, controller } = build();
    const seen: Tier[] = [];
    for (let report = 1; report <= 5; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START + report * 5_000);
      seen.push(session.autoTier);
    }
    expect(seen).toEqual(['degraded', 'degraded', 'degraded', 'degraded', 'full']);
  });

  it('does not demote on a single bad sample', () => {
    const { session, controller } = build();
    for (let report = 1; report <= 5; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START + report * 5_000);
    }
    expect(session.autoTier).toBe('full');

    controller.applyReport(BAD_FOR_FULL.rttMs, BAD_FOR_FULL.jitterMs, START + 30_000);
    expect(session.autoTier).toBe('full');
    controller.applyReport(BAD_FOR_FULL.rttMs, BAD_FOR_FULL.jitterMs, START + 35_000);
    expect(session.autoTier).toBe('full');
    const update = controller.applyReport(
      BAD_FOR_FULL.rttMs,
      BAD_FOR_FULL.jitterMs,
      START + 40_000,
    );
    expect(session.autoTier).toBe('degraded');
    expect(update).toMatchObject({ changed: true, reason: 'hysteresis' });
  });

  it('demotes on OR and promotes on AND', () => {
    // Jitter alone is enough to demote.
    const jittery = build();
    for (let report = 1; report <= 5; report += 1) {
      jittery.controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START + report * 5_000);
    }
    expect(jittery.session.autoTier).toBe('full');
    for (let report = 1; report <= 3; report += 1) {
      jittery.controller.applyReport(40, HYSTERESIS.fullToDegraded.jitterMs + 1, START + 100_000);
    }
    expect(jittery.session.autoTier).toBe('degraded');

    // Good RTT but bad jitter must never promote.
    const halfGood = build();
    for (let report = 1; report <= 10; report += 1) {
      halfGood.controller.applyReport(10, HYSTERESIS.degradedToFull.jitterMs + 1, START);
    }
    expect(halfGood.session.autoTier).toBe('degraded');
  });

  it('walks DEGRADED → MINIMAL and back, with the same asymmetry', () => {
    const { session, controller } = build();
    for (let report = 1; report <= 3; report += 1) {
      controller.applyReport(BAD_FOR_DEGRADED.rttMs, BAD_FOR_DEGRADED.jitterMs, START);
    }
    expect(session.autoTier).toBe('minimal');

    for (let report = 1; report <= 4; report += 1) {
      controller.applyReport(100, 10, START);
      expect(session.autoTier).toBe('minimal');
    }
    controller.applyReport(100, 10, START);
    expect(session.autoTier).toBe('degraded');
  });

  it('resets the counters when a report confirms neither direction', () => {
    const { session, controller } = build();
    for (let report = 1; report <= 4; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START);
    }
    // In between: not good enough to promote, not bad enough to demote.
    controller.applyReport(200, 30, START);
    expect(session.consecutiveGoodReports).toBe(0);
    expect(session.autoTier).toBe('degraded');

    for (let report = 1; report <= 4; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START);
      expect(session.autoTier).toBe('degraded');
    }
    controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START);
    expect(session.autoTier).toBe('full');
  });

  it('an override moves effectiveTier only; autoTier keeps being computed', () => {
    const { session, controller } = build();
    const applied = controller.setOverride('minimal');
    expect(applied).toMatchObject({ changed: true, reason: 'override' });
    expect(session.effectiveTier).toBe('minimal');

    for (let report = 1; report <= 5; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START + report * 5_000);
    }
    expect(session.autoTier).toBe('full');
    expect(session.effectiveTier).toBe('minimal');
  });

  it('removing the override returns to the current autoTier, with no re-warm-up', () => {
    const { session, controller } = build();
    controller.setOverride('minimal');
    for (let report = 1; report <= 5; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START + report * 5_000);
    }

    const cleared = controller.setOverride(null);
    expect(cleared).toMatchObject({ changed: true, effectiveTier: 'full', reason: 'override' });
    expect(session.effectiveTier).toBe('full');
  });

  it('walks the missing-report ladder at 15 s and 30 s', () => {
    const { session, controller } = build();
    for (let report = 1; report <= 5; report += 1) {
      controller.applyReport(GOOD.rttMs, GOOD.jitterMs, START + report * 5_000);
    }
    expect(session.autoTier).toBe('full');
    const lastReport = START + 25_000;

    controller.applySilence(lastReport + MISSING_REPORT_MS.demoteOneTier - 1);
    expect(session.autoTier).toBe('full');

    const demoted = controller.applySilence(lastReport + MISSING_REPORT_MS.demoteOneTier);
    expect(session.autoTier).toBe('degraded');
    expect(demoted).toMatchObject({ changed: true, reason: 'missing_reports' });

    controller.applySilence(lastReport + MISSING_REPORT_MS.forceMinimal);
    expect(session.autoTier).toBe('minimal');
  });

  it('measures silence from connect time when no report has ever arrived', () => {
    const { session, controller } = build();
    controller.applySilence(START + MISSING_REPORT_MS.forceMinimal);
    expect(session.autoTier).toBe('minimal');
  });

  it('pins the documented thresholds', () => {
    expect(HYSTERESIS).toMatchObject({
      demoteReports: 3,
      promoteReports: 5,
      fullToDegraded: { rttMs: 150, jitterMs: 40 },
      degradedToFull: { rttMs: 100, jitterMs: 25 },
      degradedToMinimal: { rttMs: 350, jitterMs: 100 },
      minimalToDegraded: { rttMs: 250, jitterMs: 70 },
    });
    expect(MISSING_REPORT_MS).toEqual({ demoteOneTier: 15_000, forceMinimal: 30_000 });
  });
});
