# ADR 0001 — TypeScript end-to-end, not Go for the backend

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** project author

## Context

The backend is a realtime market simulator with a WebSocket fan-out. Go is genuinely excellent at
this shape of problem, and it is a reasonable default instinct. The question is whether it is the
right choice *for this deliverable*.

Two facts constrain the decision:

1. The performance problem here is nowhere near large enough to require Go. One in-memory market
   engine, a handful of connections, ~20 messages/sec/client.
2. The deliverable is evaluated in an interview. Every language in the repo is a language you will
   be asked to defend, live.

## Decision

TypeScript across frontend, backend, protocol schemas, and tests. Node.js 24 LTS + Fastify on the
server; `@fastify/websocket` / `ws` for sockets.

## Consequences

**Good**

- One protocol package (`@repo/protocol`) is genuinely shared by both apps. The same Zod schema
  validates the server's inbound frames and decodes them in the browser. That is end-to-end type
  consistency, not a hand-kept copy on each side.
- Test T3 can spin up virtual clients in-process against the real session and scheduler code,
  because it is all one runtime.
- Smaller interview surface area. One language to defend well beats two defended adequately.

**Costs, accepted**

- `bigint` arithmetic is more awkward than Go's integer types, and `JSON.stringify` will throw on a
  stray `bigint`. Mitigated by keeping conversion in one place and testing the serializer
  ([`0002-fixed-point-bigint.md`](./0002-fixed-point-bigint.md)).
- A single-threaded event loop means an unlucky stall shifts timing. Mitigated structurally by the
  logical clock — stalls change *when* ticks run, never *which*
  ([02 §3](../02-market-domain.md#4-logical-market-clock)).

## Reconsider if

Connection count or message volume grows by orders of magnitude, or the market engine becomes
CPU-bound. Neither is true at this scale.

**Corollary:** Go would be the right call for someone already fluent enough to defend Go code under
questioning. This ADR is about fit to *this* deliverable, not about language quality.
