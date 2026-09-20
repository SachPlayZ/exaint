# 05 — Testing

| | |
| --- | --- |
| **Audience** | Everyone. No phase closes without the tests named here |
| **Read this when** | Writing tests, fixing CI, or closing a phase |
| **Depends on** | [`07-invariants.md`](./07-invariants.md) — every test below defends an invariant |

The assignment asks for two tests. Ship these five plus the Playwright suite. The tests *are* the
argument; without them the invariants are just claims.

| | Test | Defends | Tool | Phase |
| --- | --- | --- | --- | --- |
| T1 | Tier hysteresis | correct tiering, no flapping | Vitest | P6 |
| T2 | Order-book synchronisation | I1 | Vitest | P8 |
| T3 | Candle equality across tiers | I2 | Vitest | P6 |
| T4 | Property-based order book | I1 | fast-check | P8 |
| T5 | Late history response | interval-switch race | Vitest | P9 |
| T6 | Symbol isolation + switch race | I1, I3 | Vitest | P9 |
| T7 | Auth ticket + rate limiter | transport hardening | Vitest | P5/P6 |
| E2E | Recovery flows | I1 + stale UX | Playwright | P12 |

---

## T1 — Tier hysteresis

Start:

```text
DEGRADED
```

Feed good network reports. Assert the promotion is **slow**:

```text
1 good → degraded
2 good → degraded
3 good → degraded
4 good → degraded
5 good → FULL
```

Then one bad report:

```text
FULL
```

— a single bad sample must **not** demote. Then three sustained bad reports:

```text
DEGRADED
```

Also cover:

```text
override
override removal
missing reports
```

- **override** — `effectiveTier` changes, `automaticTier` keeps being computed
- **override removal** (`tier: null`) — connection returns to whatever `automaticTier` currently is,
  with no re-warm-up
- **missing reports** — the `15s / 30s / 45s` ladder from
  [`03-adaptive-delivery.md §6`](./03-adaptive-delivery.md#6-missing-reports)

Drive it with a fake clock. Never with real timers.

---

## T2 — Order-book synchronisation

Given:

```text
buffer = [99, 101, 102]

snapshot = 100
```

It should:

```text
discard 99
apply 101
apply 102
```

Then:

```text
current = 102
next previousSequence = 104
```

must result in:

```text
RESYNC_REQUIRED
```

Additional cases worth the five minutes: duplicate delta, out-of-order arrival, delta with
quantity `0` deleting a level, empty snapshot.

---

## T3 — Candle equality across tiers

**Mandatory**, even though the assignment only requires two tests. This test directly proves the
central requirement of the whole assignment.

Generate:

```text
10,000 deterministic trades
```

Connect three virtual clients:

```text
FULL
DEGRADED
MINIMAL
```

Run it **per symbol**, and once more with the three clients on three different symbols. The second
arrangement is what catches a scheduler that keys delivery state by connection instead of by
`(connection, symbol)` — a bug that the single-symbol version cannot see.

After the candles close:

```ts
expect(fullFinalCandles)
  .toEqual(degradedFinalCandles)

expect(degradedFinalCandles)
  .toEqual(minimalFinalCandles)
```

"Virtual client" means an in-process `ConnectionSession` + scheduler with a fake socket and a fake
clock. No network, no browser. This runs in milliseconds and is the single most valuable test in
the repo.

Assert as well that the Minimal client received **every** finalised candle — equality of the final
set is necessary but not sufficient if a candle went missing at both ends.

With tier-scaled trade batching, also assert that no **trade** is double-counted into a candle at
any tier: candle `tradeCount` must match the canonical count regardless of how the batches fell.

---

## T4 — Property-based order book

Use `fast-check`.

Generate arbitrary:

```text
snapshot
valid deltas
duplicates
gaps
```

Property:

> Applying any valid contiguous delta chain must produce the same book as the authoritative server
> book.

And:

> A gap must always result in resynchronisation.

One property test here is worth more than twenty hand-written unit tests, and reviewers read it
that way.

---

## T5 — Late history response

```text
select 1m
request delayed

select 5s
5s response finishes

1m response finishes
```

Chart must remain:

```text
5s
```

Assert on the adapter's `setData` calls, not on rendered pixels.

---

## T6 — Symbol isolation and switch race

Two halves, one file.

**Isolation.** Drive two symbols through one engine set and assert nothing crosses:

```text
BTC-USD bookSequence advances
SOL-USD bookSequence unchanged
```

A gap injected into `SOL-USD` must resync `SOL-USD` and leave `BTC-USD` `SYNCHRONIZED`. Trade ids
must be independent counters, not a shared one.

**Switch race.** The symbol analogue of T5:

```text
select SOL-USD
snapshot + history requests delayed

select HYPE-USD
HYPE-USD responses finish

SOL-USD responses finish
```

Chart and book must remain:

```text
HYPE-USD
```

A late `SOL-USD` snapshot merged into a `HYPE-USD` book produces a plausible-looking, silently
wrong panel. That is precisely why this test exists.

Also assert the switch **subscribes before unsubscribing** and leaves exactly one subscription
behind — a leaking switcher hits `TOO_MANY_SUBSCRIPTIONS` after five clicks.

---

## T7 — Auth ticket and rate limiter

**Ticket:**

```text
valid ticket                  → hello
missing ticket                → UNAUTHORIZED, close 4401
bad signature                 → UNAUTHORIZED, close 4401
expired ticket (exp in past)  → TICKET_EXPIRED, close 4408
replayed ticket (second use)  → TICKET_EXPIRED, close 4408
```

Plus: a connection established with a valid ticket **survives past that ticket's `exp`**. The
ticket authorises the connect, not the session — a test that asserts this stops someone
"helpfully" adding session expiry later.

**Rate limiter:**

```text
ping at 2/s        → never limited
ping burst of 10   → first 4 pass, rest RATE_LIMITED, connection alive
3 strikes in 10s   → close 4429
```

Drive with a fake clock. Assert token buckets refill correctly rather than just counting rejects.

---

## Playwright recovery tests

Playwright can inspect and manipulate WebSockets — including blocking selected WS messages — and its
`BrowserContext` can emulate offline state. That combination is what makes these flows testable at
all.

```text
open app

assert LIVE

drop book delta

assert RESYNCING
assert book recovers

switch symbol BTC-USD → HYPE-USD

assert chart, book and trades all show HYPE-USD
assert no stale BTC-USD rows leak in

set offline

assert STALE

restore network

assert fresh ticket fetched
assert RECONNECTING
assert LIVE
```

This is the demonstration of correctness. Record it for the demo video too (§ demo script in
[`PLAN.md`](../PLAN.md#demo-script-final-gate)).

---

## Failure cases with explicit tests (P11)

Each of these has its own test, not a shared smoke test:

```text
network failure
missing book event
invalid JSON
late history
late snapshot after symbol switch
duplicate candle
expired ticket on reconnect
rate-limit strike close (4429)
hidden tab
backend restart
```

- **invalid JSON** — fuzzed garbage frames; handler survives, process survives, client receives
  `INVALID_MESSAGE`
- **duplicate candle** — two versions of the same `interval + candleStart`; higher `lastTradeId`
  wins
- **hidden tab** — hide under `30s` resumes normally; hide over `30s` triggers a snapshot +
  history hard refresh of the selected symbol
- **expired ticket on reconnect** — close `4408` leads to a *new* ticket fetch, never a retry of
  the old one
- **rate-limit strike close** — close `4429` reconnects with backoff, not immediately
- **backend restart** — client reaches `LIVE` again with a correct book, no manual reload

---

## Determinism in tests

- Pin the seed and start time:

  ```ts
  seed = 1
  startTime = 1_700_000_000_000
  ```

- Fake timers everywhere. A test that sleeps is a test that will flake in CI.
- Same seed twice ⇒ identical event stream, asserted directly (P2).

---

## CI

**Pull request:**

```text
Pull Request

install
   ↓
lint
   ↓
typecheck
   ↓
unit tests
   ↓
build
   ↓
Playwright
```

**Main branch:**

```text
tests
   ↓
build frontend
build Docker backend
   ↓
deploy backend
deploy frontend
```

Add branch protection if you want to polish it further.

---

## Open questions

- Coverage threshold, or none? *(assumed: none — targeted tests over a coverage number)*
- Should T3 run at a second seed in CI as a cheap fuzz? *(assumed: yes, two seeds)*
- Does T3 need to run across all five symbols in CI, or is two enough? *(assumed: two symbols in
  CI, all five in a nightly run if one is added)*
