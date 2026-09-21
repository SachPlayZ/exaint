# ADR 0007 — Short-lived connect tickets for the WebSocket, plus per-connection rate limits

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

The deployed demo has a public WebSocket endpoint backed by a single stateful process holding all
market state in memory ([`0004-no-redis-nats.md`](./0004-no-redis-nats.md)). An open endpoint is an
open invitation: anyone can hold a thousand sockets, or spray frames until the event loop that also
runs the market clock falls behind.

That last part is the real risk. A stalled event loop does not corrupt the market — the logical
clock protects against that ([`../02-market-domain.md §4`](../02-market-domain.md#4-logical-market-clock))
— but it does degrade every connected client.

There are no user accounts and there should not be. This is not authentication of *people*. It is
admission control for connections.

## Decision

Two mechanisms, deliberately small.

### 1. Connect tickets

`POST /v1/auth/ticket` mints an HMAC-SHA256 signed, `60s`, single-use ticket. The client passes it
as `wss://…/v1/ws?ticket=<t>`. The server verifies signature, expiry, and non-replay, then marks it
consumed.

**Why a query parameter.** Browsers cannot set arbitrary headers on a `WebSocket` handshake. The
options are a subprotocol hack, a cookie, or a query parameter. A short-lived single-use ticket in
the query string is the honest one: it is scoped to a single connect, it expires in a minute, and
a copy recovered from a log buys an attacker nothing because it has already been consumed.

**The ticket authorises the connect, not the session.** Once the socket is open, `exp` is
irrelevant and the connection is never torn down for ticket age. Liveness is the heartbeat's job.
Conflating the two would kill healthy long-lived sockets every minute, which is the failure mode
this decision most wants to avoid — hence an explicit test for it (T7).

### 2. Per-connection rate limits

Token buckets per frame type plus a global bucket
([`../01-protocol.md §8`](../01-protocol.md#8-rate-limiting)). Exceeding a bucket drops that frame
and replies `RATE_LIMITED`; the connection survives, because a burst is usually a client bug. Three
strikes in 10 s closes with `4429`.

Budgets are an order of magnitude above documented client behaviour — a well-behaved client sends
one `ping` every `2s` and one `network.report` every `5s`. A client that trips them is misbehaving.

## Consequences

**Good**

- The demo is not an open firehose, and the market engine's event loop is protected.
- `sub` from the ticket gives a per-client rate-limit key without storing anything about anyone.
- `AUTH_MODE=off` keeps local development frictionless.
- Auth failures are observable: `auth_failures{reason}`, and close codes the client can act on.

**Costs, accepted**

- Every reconnect needs a REST round trip before the socket. Mitigated by doing the fetch **inside**
  the backoff delay, so a down backend does not bypass backoff
  ([`../04-frontend.md §4`](../04-frontend.md#4-authentication)).
- `AUTH_TICKET_SECRET` is now a required production secret. Documented in
  [`../06-ops-deploy.md §2`](../06-ops-deploy.md#3-environment-variables).
- Consumed ticket ids must be tracked. Bounded: a TTL set that cannot exceed `TTL × mint rate`.

## Alternatives rejected

- **No auth at all** — the original assumption. Fine for localhost, careless for a public URL
  fronting a single stateful process.
- **A long-lived API key in the query string** — same exposure surface, none of the expiry.
- **Cookie-based session** — cross-origin (Vercel → backend) cookies for a WebSocket are more
  configuration and more failure modes than a ticket, for no extra security here.
- **Full user accounts** — solves a problem this project does not have, and would dominate the
  effort budget.

## Related

[`../01-protocol.md §7`](../01-protocol.md#7-authentication),
[`../04-frontend.md §4`](../04-frontend.md#4-authentication),
[`../05-testing.md`](../05-testing.md#t7--auth-ticket-and-rate-limiter).
