import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TicketPayload } from '@repo/protocol';
import { TicketPayloadSchema } from '@repo/protocol';

/**
 * Short-lived, single-use connect tickets.
 *
 * This is not user auth — there are no accounts. It stops the deployed demo
 * being an open firehose, and gives the server somewhere to hang a rate-limit
 * identity (docs/01-protocol.md §7, docs/adr/0007-ws-auth-ticket.md).
 *
 * The ticket authorises the **connect**, not the session. Nothing here tears
 * down a live socket at `exp`.
 */

export type TicketRejection = 'UNAUTHORIZED' | 'TICKET_EXPIRED';

export type TicketVerification =
  | { readonly ok: true; readonly payload: TicketPayload }
  | { readonly ok: false; readonly reason: TicketRejection };

export interface MintedTicket {
  readonly ticket: string;
  readonly expiresAt: number;
  readonly subject: string;
}

const base64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

export class TicketService {
  readonly ttlMs: number;
  readonly #secret: string;
  readonly #now: () => number;
  /** Consumed ticket ids, kept only while they could still be replayed. */
  readonly #consumed = new Map<string, number>();

  constructor(options: {
    readonly secret: string;
    readonly ttlMs: number;
    readonly now?: () => number;
  }) {
    if (options.secret.length === 0) {
      throw new Error('AUTH_TICKET_SECRET is required when AUTH_MODE=ticket');
    }
    this.#secret = options.secret;
    this.ttlMs = options.ttlMs;
    this.#now = options.now ?? Date.now;
  }

  /** Opaque anonymous id, minted per request. Not a user; nothing is stored about it. */
  static mintSubject(): string {
    return `anon-${randomBytes(4).toString('hex')}`;
  }

  #sign(encodedPayload: string): string {
    return createHmac('sha256', this.#secret).update(encodedPayload).digest('base64url');
  }

  mint(subject: string = TicketService.mintSubject()): MintedTicket {
    const issuedAt = this.#now();
    const expiresAt = issuedAt + this.ttlMs;
    const payload: TicketPayload = { sub: subject, iat: issuedAt, exp: expiresAt };
    const encoded = base64url(JSON.stringify(payload));
    return { ticket: `${encoded}.${this.#sign(encoded)}`, expiresAt, subject };
  }

  /**
   * Verifies signature, expiry and replay, and consumes the ticket on success.
   *
   * Rejection reasons are the documented error codes, so the caller does not
   * have to invent a mapping: a bad or malformed ticket is `UNAUTHORIZED`, a
   * stale or replayed one is `TICKET_EXPIRED`.
   */
  verifyAndConsume(ticket: string | undefined): TicketVerification {
    this.#evictExpired();

    if (typeof ticket !== 'string' || ticket.length === 0) {
      return { ok: false, reason: 'UNAUTHORIZED' };
    }
    const separator = ticket.indexOf('.');
    if (separator <= 0 || separator === ticket.length - 1) {
      return { ok: false, reason: 'UNAUTHORIZED' };
    }
    const encodedPayload = ticket.slice(0, separator);
    const signature = ticket.slice(separator + 1);

    const expected = Buffer.from(this.#sign(encodedPayload));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return { ok: false, reason: 'UNAUTHORIZED' };
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'UNAUTHORIZED' };
    }
    const parsed = TicketPayloadSchema.safeParse(decoded);
    if (!parsed.success) return { ok: false, reason: 'UNAUTHORIZED' };

    const now = this.#now();
    if (parsed.data.exp <= now) return { ok: false, reason: 'TICKET_EXPIRED' };
    // Single use: a replay is indistinguishable from a stolen ticket.
    if (this.#consumed.has(encodedPayload)) return { ok: false, reason: 'TICKET_EXPIRED' };

    this.#consumed.set(encodedPayload, parsed.data.exp);
    return { ok: true, payload: parsed.data };
  }

  /** Consumed ids currently held. Bounded by the TTL, so it cannot grow without limit. */
  get consumedCount(): number {
    this.#evictExpired();
    return this.#consumed.size;
  }

  #evictExpired(): void {
    const now = this.#now();
    for (const [id, expiresAt] of this.#consumed) {
      if (expiresAt <= now) this.#consumed.delete(id);
    }
  }
}
