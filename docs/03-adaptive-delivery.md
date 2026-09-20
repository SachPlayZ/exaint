# 03 — Adaptive Delivery

| | |
| --- | --- |
| **Audience** | Whoever builds the tier controller, delivery scheduler, or connection session |
| **Read this when** | You touch `apps/api/src/websocket/**`, or the client's latency measurement |
| **Depends on** | [`07-invariants.md`](./07-invariants.md); frame shapes in [`01-protocol.md`](./01-protocol.md) |

This doc is self-contained: the state machine below is implementable from this file alone.

---

## 1. The central rule

> Tiering decides **how often** a client is updated. It never decides **what** the update says.

The market engine has already computed everything. This layer only paces delivery.

```text
Full client       ──────► 10 candle updates/sec
Degraded client   ──────►  2 candle updates/sec
Minimal client    ──────►  0.5 candle updates/sec

                         BUT

Canonical candle ──────► exactly identical for all three.
```

Consequence, and it is worth stating out loud in an interview: **we are not inventing trades to hit
these rates.** The numbers below are *maximum delivery frequencies*, not generation rates. A quiet
market sends less. A busy market never sends more.

Enforced by [`07-invariants.md` I2](./07-invariants.md#i2--candle-invariance) and test T3.

---

## 2. Delivery scheduler

| Tier | `candles.update` | `trades.batch` | Intended situation |
| --- | ---: | ---: | --- |
| `FULL` | 10 Hz / 100 ms | 5 Hz / 200 ms | healthy connection |
| `DEGRADED` | 2 Hz / 500 ms | 2 Hz / 500 ms | moderate latency or jitter |
| `MINIMAL` | 0.5 Hz / 2000 ms | 0.5 Hz / 2000 ms | poor connection |

Ten updates per second looks fluid without being silly. Two per second still reads as clearly live.
One every two seconds substantially reduces delivery pressure.

**Both cadences are tier-scaled.** Trade batches are display-only — the client keeps 50 and the
list is unreadable above a few hertz — so pacing them with the tier is free correctness-wise and
roughly halves frame count for a degraded client. At `FULL` trades run at half the candle rate
deliberately: the chart benefits from 10 Hz, a scrolling trade list does not.

Book deltas are **not** paced. They carry correctness, not decoration — see §9 and
[`07-invariants.md` I1](./07-invariants.md#i1--order-book-continuity).

Cadences are **per subscribed symbol**. A connection with two symbols at `FULL` sends each symbol's
candles at 10 Hz; the tier is a property of the connection, the schedule is per symbol.

### Finalised candles are never dropped

A Minimal client is updated every 2000 ms. A `1s` candle can therefore open **and close** between
two of its updates. Throwing that candle away would violate I2.

So each connection's scheduler holds, **per subscribed symbol and interval**:

```text
pending finalized candles     (queue, ordered)
latest active candle          (single slot, coalesced)
```

At the next permitted send:

```text
send:
  finalized candle(s)
  +
  newest active candle
```

Which produces, for a Minimal client:

```text
candles.update
  candle startTime 1789874704000   final true      ← closed while the client was waiting
  candle startTime 1789874705000   final false     ← the current one
```

Full frame shape: [`01-protocol.md §6`](./01-protocol.md#candlesupdate).

The active-candle slot **coalesces** — a newer version replaces the older, because only the latest
matters. The finalised queue **accumulates** — every closed candle is delivered exactly once.

That asymmetry is the whole trick. It is also an excellent detail to raise unprompted in the
interview.

---

## 3. Latency measurement

Application-level, not TCP.

The browser sends a WebSocket ping every:

```text
2 seconds
```

```json
{
  "type": "ping",
  "id": "1192"
}
```

Client records:

```ts
const sentAt = performance.now()
```

Server replies **immediately** — do not queue a pong behind data frames:

```json
{
  "type": "pong",
  "id": "1192"
}
```

On arrival:

```ts
RTT = performance.now() - sentAt
```

Use `performance.now()`, not `Date.now()`. You are measuring a duration, and `Date.now()` is subject
to clock adjustment.

This is **round-trip** latency. It is explicitly not an attempt to estimate one-way latency. State
that in the README.

---

## 4. Latency and jitter smoothing

Client maintains EWMA values with `α = 0.2`.

**RTT:**

```text
latency_n =
    0.2 × currentRTT
  + 0.8 × previousLatency
```

**Jitter:**

```text
difference =
  abs(currentRTT - previousRTT)

jitter_n =
    0.2 × difference
  + 0.8 × previousJitter
```

Reported to the backend every `5 seconds`:

```json
{
  "type": "network.report",
  "rttMs": 82.4,
  "jitterMs": 11.8,
  "samples": 12
}
```

`samples` is the number of RTT measurements folded into this report — with a 2 s ping and a 5 s
report that is normally 2–3; a larger number after a stall is itself a signal.

---

## 5. Hysteresis

Never write this:

```ts
if (rtt > 100) degraded
else full
```

It flaps continuously, the tier indicator strobes, and the demo looks broken.

Use **separate promotion and demotion thresholds**, each requiring consecutive confirming reports.

### FULL → DEGRADED

Require **3 consecutive** reports where:

```text
RTT > 150ms
OR
jitter > 40ms
```

### DEGRADED → FULL

Require **5 consecutive** reports where:

```text
RTT < 100ms
AND
jitter < 25ms
```

### DEGRADED → MINIMAL

Require **3 consecutive** reports where:

```text
RTT > 350ms
OR
jitter > 100ms
```

### MINIMAL → DEGRADED

Require **5 consecutive** reports where:

```text
RTT < 250ms
AND
jitter < 70ms
```

Note the deliberate asymmetry:

- Demotion needs **3** reports, promotion needs **5**.
- Demotion triggers on **OR** (either metric bad is enough).
- Promotion requires **AND** (both metrics must be good).

Degrading is cheap and reversible; promoting a client onto a connection that cannot carry the rate
is not. That asymmetry *is* the hysteresis.

Counters `consecutiveGoodReports` / `consecutiveBadReports` reset whenever a report fails to
confirm the direction being accumulated.

### Initial tier

New connections start at:

```text
DEGRADED
```

**not** `FULL`. We do not yet know anything about this connection, and pretending otherwise is the
mistake the hysteresis exists to prevent. After enough reports, the controller moves the connection
where it belongs.

---

## 6. Missing reports

Document this explicitly; reviewers ask.

```text
0-15 sec without reports:
    retain current tier

15 sec:
    downgrade one tier

30 sec:
    force MINIMAL

45 sec without successful heartbeat:
    close socket
```

After the close, the frontend's reconnect machinery takes over — backoff, fresh snapshot, fresh
history ([`04-frontend.md §10`](./04-frontend.md#11-disconnect-and-reconnect)).

---

## 7. Debug override

A developer control in the UI:

```text
Adaptive
Full
Degraded
Minimal
```

Frame:

```json
{
  "type": "debug.tier_override",
  "tier": "minimal"
}
```

Back to automatic:

```json
{
  "type": "debug.tier_override",
  "tier": null
}
```

**Measurement continues while overridden.** The override changes only:

```text
effectiveTier
```

and never:

```text
automaticTier
```

So the debug drawer can show both, which is exactly what makes the screen recording convincing:

```text
Automatic: Full
Effective: Minimal
Override: Minimal

RTT: 41ms
Jitter: 5ms
Target: 0.5Hz
Actual: 0.49Hz
```

The client never picks its own *automatic* tier. The server owns that. The client may only request
an override, and only when `ENABLE_DEBUG_CONTROLS` is on.

---

## 8. ConnectionSession

Per-socket state. **Tier state is never global.**

```ts
ConnectionSession {
  connectionId
  subject                  // `sub` from the auth ticket — the rate-limit key

  autoTier                 // connection-scoped, never per symbol
  tierOverride
  effectiveTier

  rtt
  jitter

  consecutiveGoodReports
  consecutiveBadReports
  lastNetworkReportAt

  rateLimitBuckets         // per frame type + global
  rateLimitStrikes

  subscriptions: Map<Symbol, SymbolSubscription>

  connectedAt
}

SymbolSubscription {
  symbol
  channels                 // book | trades | candles
  subscribedInterval

  lastCandleSentAt
  pendingFinalCandles
  latestActiveCandle

  lastTradeBatchSentAt
  pendingTrades
}
```

Tier lives on the session. Delivery state lives on the subscription. That split is what lets one
connection hold five symbols without five tiers.

Acceptance check for this section: open three browser tabs and hold

```text
Tab 1: FULL
Tab 2: DEGRADED
Tab 3: MINIMAL
```

simultaneously, against one backend, with identical candle values in all three — and repeat it with
the three tabs on three *different* symbols to confirm nothing leaks across the registry.

---

## 9. Backpressure

Check the socket's `bufferedAmount`. If a client's outbound buffer grows, do not queue indefinitely.

| Stream | Policy | Why it is safe |
| --- | --- | --- |
| Candle updates | **Coalesce to latest** active candle; keep the finalised queue | Only the newest active candle matters; finalised ones are still delivered |
| Trade batches | **Drop old batches** if necessary | Display-only, capped at 50 client-side anyway, and already tier-paced |
| Order book deltas | **Never drop.** If the outbound book stream is unrecoverably backlogged, **close the connection** | The client reconnects and takes a fresh snapshot — correct by construction |

The reasoning to state plainly: **correctness beats pretending the connection is alive.** A dropped
delta silently corrupts the client's book; a closed socket triggers a clean, observable resync.

Close with `BACKPRESSURE_CLOSE` so the reason is visible in logs and metrics.

### Thresholds

Chosen in P6, measured against `bufferedAmount`:

| Threshold | Bytes | Behaviour |
| --- | ---: | --- |
| Soft | `256 KiB` | Stop sending `trades.batch`; candles keep coalescing; deltas unaffected |
| Hard | `1 MiB` | `error: BACKPRESSURE_CLOSE`, then close `4409` |

A 25-level `book.delta` is roughly 200–600 bytes and a symbol emits about twenty per second, so
`256 KiB` is around twenty seconds of one symbol's deltas — far past "briefly congested" and well
short of a hair trigger. `1 MiB` is roughly eighty seconds of backlog: at that point there is no
lever left, because deltas may not be dropped.

---

## 10. What the tier does *not* affect

Spell this out, because it is the thing being graded:

- Trade processing — 100% of trades are processed for every client
- Order book state — one book, delivered completely to everyone
- Candle values — identical OHLCV, proven by test T3
- Order book delta delivery — deltas are never paced away or dropped

Only the **cadence of `candles.update` and `trades.batch`** varies. Both are pacing decisions made
after the canonical values already exist.

---

## Open questions

**Resolved:**

- `bufferedAmount` thresholds: `256 KiB` soft, `1 MiB` hard (§9).

- Trade-batch cadence **is** tier-scaled (§2), not flat.
- `tier.changed` carries the reason (`hysteresis` / `override` / `missing_reports`).
- Tier is connection-scoped; delivery schedule is per symbol (§8).
