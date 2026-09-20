# ADR 0004 — One authoritative instance; no Redis, NATS, Kafka, or Postgres

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

Adding a message bus or a datastore is the easy way to make an architecture diagram look
"production". It is also the easy way to fail a review, because the reviewer's next question is
"what problem does that solve here?" and there is no answer.

The real constraint is more interesting. If two replicas each run their own seeded simulator:

```text
backend replica A
backend replica B

A != B
```

Two clients load-balanced onto different replicas see two different markets. Horizontal scaling is
not merely unnecessary here — done naively it is *incorrect*.

## Decision

Run **one authoritative backend market-engine instance**, with all state in memory. No Redis, no
NATS, no Kafka, no Postgres.

Document the production scaling path without building it:

```text
                    Market Engine
                         │
                         ▼
                   NATS / Redis
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
        WS Gateway   WS Gateway   WS Gateway
```

One engine produces; stateless gateways fan out; snapshots come from shared authoritative state.

## Consequences

**Good**

- Zero infrastructure failure modes that are not load-bearing.
- The single-instance constraint becomes a *deliberate, explained* decision rather than an
  oversight — which is the stronger interview answer.
- Deployment is one container.

**Costs, accepted**

- No horizontal scaling. Documented as a known limitation in the README.
- A restart loses market history. Acceptable: the market is synthetic, and the client refetches
  history and a fresh snapshot on reconnect ([04 §10](../04-frontend.md#11-disconnect-and-reconnect)).
- Single point of failure. Acceptable for this deliverable, and stated as such.

## Reconsider if

Real persistence is required, or connection volume exceeds one process. Then build the diagram
above — engine stays singular, gateways become plural.

## Related

[06 §6](../06-ops-deploy.md#7-scaling-caveat), [00 §6](../00-architecture.md#6-single-instance-constraint).
