/**
 * Reconnect backoff — exponential with jitter (docs/04-frontend.md §11).
 *
 * Jitter exists so a backend restart does not bring every client back in the
 * same millisecond.
 */

export const BACKOFF_STEPS_MS: readonly number[] = Object.freeze([
  250, 500, 1_000, 2_000, 4_000, 8_000,
]);

export const BACKOFF_MAX_MS = 10_000;

/**
 * A connection that has been healthy for longer than the backoff ceiling has
 * demonstrably recovered, so the retry count resets. Deriving the window from
 * the ceiling avoids inventing a second number for "sufficiently stable".
 */
export const STABLE_CONNECTION_MS = BACKOFF_MAX_MS;

/** ±20% spread. Enough to break up a thundering herd, small enough to stay predictable. */
const JITTER_RATIO = 0.2;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.max(0, attempt);
  const base = BACKOFF_STEPS_MS[Math.min(index, BACKOFF_STEPS_MS.length - 1)] ?? BACKOFF_MAX_MS;
  const bounded = index >= BACKOFF_STEPS_MS.length ? BACKOFF_MAX_MS : base;
  const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return Math.round(bounded * jitter);
}

/** True once the ceiling has been hit repeatedly — the UI surfaces `ERROR` from here. */
export const ERROR_AFTER_ATTEMPTS = BACKOFF_STEPS_MS.length + 3;
