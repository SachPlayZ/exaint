import { describe, expect, it } from 'vitest';
import { TicketPayloadSchema } from '@repo/protocol';
import { TicketService } from '../../src/auth/ticket-service.js';

const SECRET = 'a-secret-used-only-by-this-test';

function buildService(now: { value: number }, ttlMs = 60_000): TicketService {
  return new TicketService({ secret: SECRET, ttlMs, now: () => now.value });
}

describe('TicketService (T7, ticket half)', () => {
  it('mints a ticket that verifies once', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    const minted = service.mint();

    expect(minted.expiresAt).toBe(1_060_000);
    const result = service.verifyAndConsume(minted.ticket);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sub).toBe(minted.subject);
      expect(TicketPayloadSchema.parse(result.payload)).toEqual(result.payload);
    }
  });

  it('rejects a missing ticket as UNAUTHORIZED', () => {
    const service = buildService({ value: 0 });
    for (const bad of [undefined, '', 'no-dot', '.sig', 'payload.']) {
      const result = service.verifyAndConsume(bad);
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.reason, String(bad)).toBe('UNAUTHORIZED');
    }
  });

  it('rejects a bad signature as UNAUTHORIZED', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    const { ticket } = service.mint();
    const [payload] = ticket.split('.');

    expect(service.verifyAndConsume(`${payload}.deadbeef`)).toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED',
    });

    // A ticket signed with a different secret must not be accepted either.
    const impostor = new TicketService({ secret: 'other', ttlMs: 60_000, now: () => now.value });
    expect(service.verifyAndConsume(impostor.mint().ticket)).toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED',
    });
  });

  it('rejects a tampered payload — the signature covers it', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    const { ticket } = service.mint();
    const signature = ticket.slice(ticket.indexOf('.') + 1);
    const forged = Buffer.from(
      JSON.stringify({ sub: 'anon-attacker', iat: now.value, exp: now.value + 10_000_000 }),
    ).toString('base64url');

    expect(service.verifyAndConsume(`${forged}.${signature}`)).toMatchObject({
      ok: false,
      reason: 'UNAUTHORIZED',
    });
  });

  it('rejects an expired ticket as TICKET_EXPIRED', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    const { ticket } = service.mint();

    now.value += 59_999;
    expect(service.verifyAndConsume(ticket).ok).toBe(true);

    const second = buildService(now);
    const fresh = second.mint();
    now.value += 60_000;
    expect(second.verifyAndConsume(fresh.ticket)).toMatchObject({
      ok: false,
      reason: 'TICKET_EXPIRED',
    });
  });

  it('rejects a replay as TICKET_EXPIRED — single use means single use', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    const { ticket } = service.mint();

    expect(service.verifyAndConsume(ticket).ok).toBe(true);
    expect(service.verifyAndConsume(ticket)).toMatchObject({
      ok: false,
      reason: 'TICKET_EXPIRED',
    });
  });

  it('bounds the consumed set by the TTL rather than growing forever', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    for (let index = 0; index < 20; index += 1) {
      now.value += 1;
      service.verifyAndConsume(service.mint().ticket);
    }
    expect(service.consumedCount).toBe(20);

    now.value += 60_001;
    expect(service.consumedCount).toBe(0);
  });

  it('mints a distinct anonymous subject per ticket', () => {
    const now = { value: 1_000_000 };
    const service = buildService(now);
    const subjects = new Set(Array.from({ length: 50 }, () => service.mint().subject));
    expect(subjects.size).toBe(50);
    for (const subject of subjects) expect(subject).toMatch(/^anon-[0-9a-f]{8}$/);
  });

  it('refuses to run without a secret', () => {
    expect(() => new TicketService({ secret: '', ttlMs: 60_000 })).toThrow(/AUTH_TICKET_SECRET/);
  });
});
