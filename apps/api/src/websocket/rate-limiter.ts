import type { ClientFrameType } from '@repo/protocol';

/**
 * Per-connection token buckets, one per frame type plus a global one.
 *
 * Exceeding a bucket **drops that frame** and replies `RATE_LIMITED`. The
 * connection survives — a burst is usually a bug, not an attack. Sustained abuse
 * (3 `RATE_LIMITED` responses within 10 s) closes the socket with `4429`
 * (docs/01-protocol.md §8).
 */

export interface BucketConfig {
  /** Tokens replenished per second. */
  readonly sustained: number;
  /** Bucket size — how much burst is tolerated. */
  readonly burst: number;
}

/** From the table in docs/01-protocol.md §8. Protocol behaviour, not deploy tuning. */
export const FRAME_BUCKETS: Readonly<Record<ClientFrameType, BucketConfig>> = Object.freeze({
  ping: { sustained: 2, burst: 4 },
  'network.report': { sustained: 1, burst: 3 },
  subscribe: { sustained: 5, burst: 10 },
  unsubscribe: { sustained: 5, burst: 10 },
  set_interval: { sustained: 5, burst: 10 },
  'debug.tier_override': { sustained: 2, burst: 5 },
});

/** Window in which strikes accumulate before the socket is closed. */
export const STRIKE_WINDOW_MS = 10_000;

class TokenBucket {
  readonly #config: BucketConfig;
  #tokens: number;
  #updatedAt: number;

  constructor(config: BucketConfig, now: number) {
    this.#config = config;
    this.#tokens = config.burst;
    this.#updatedAt = now;
  }

  /** Refills by elapsed time, then spends a token if one is available. */
  take(now: number): boolean {
    const elapsedMs = Math.max(0, now - this.#updatedAt);
    this.#updatedAt = now;
    this.#tokens = Math.min(
      this.#config.burst,
      this.#tokens + (elapsedMs / 1_000) * this.#config.sustained,
    );
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }

  tokens(now: number): number {
    const elapsedMs = Math.max(0, now - this.#updatedAt);
    return Math.min(
      this.#config.burst,
      this.#tokens + (elapsedMs / 1_000) * this.#config.sustained,
    );
  }
}

export type RateLimitVerdict = 'allow' | 'limit' | 'close';

export class ConnectionRateLimiter {
  readonly #now: () => number;
  readonly #strikeLimit: number;
  readonly #global: TokenBucket;
  readonly #byType = new Map<ClientFrameType, TokenBucket>();
  #strikes: number[] = [];

  constructor(options: {
    readonly globalPerSecond: number;
    readonly strikeLimit: number;
    readonly now?: () => number;
  }) {
    this.#now = options.now ?? Date.now;
    this.#strikeLimit = options.strikeLimit;
    const start = this.#now();
    this.#global = new TokenBucket(
      { sustained: options.globalPerSecond, burst: options.globalPerSecond * 2 },
      start,
    );
    for (const [type, config] of Object.entries(FRAME_BUCKETS) as [
      ClientFrameType,
      BucketConfig,
    ][]) {
      this.#byType.set(type, new TokenBucket(config, start));
    }
  }

  /**
   * `allow` passes the frame on. `limit` drops it and replies `RATE_LIMITED`.
   * `close` means the strike budget is spent and the socket goes with `4429`.
   */
  check(type: ClientFrameType): RateLimitVerdict {
    const now = this.#now();
    const bucket = this.#byType.get(type);
    const allowed = this.#global.take(now) && (bucket === undefined || bucket.take(now));
    if (allowed) return 'allow';

    this.#strikes = this.#strikes.filter((at) => now - at < STRIKE_WINDOW_MS);
    this.#strikes.push(now);
    return this.#strikes.length >= this.#strikeLimit ? 'close' : 'limit';
  }

  /** Strikes still inside the window. */
  get strikes(): number {
    const now = this.#now();
    return this.#strikes.filter((at) => now - at < STRIKE_WINDOW_MS).length;
  }

  /** Remaining tokens, for tests that assert refill rather than counting rejects. */
  tokensFor(type: ClientFrameType): number {
    return this.#byType.get(type)?.tokens(this.#now()) ?? 0;
  }
}
