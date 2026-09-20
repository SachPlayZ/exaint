# 07 — Invariants

| | |
| --- | --- |
| **Audience** | Everyone, every task |
| **Read this when** | Always. This is the shortest doc and the most important one |
| **Depends on** | Nothing |

Three guarantees. If asked at a whiteboard what this system guarantees, these are the answer.
A change that breaks one of them is not a trade-off to be weighed — it is a defect.

**All three are scoped per symbol.** There is no global sequence and no global trade counter; each
of the five symbols is its own independent world. "The book" below always means "the book for one
symbol".

---

## I1 — Order book continuity

```text
localBook[symbol].sequence === lastSuccessfullyAppliedDelta[symbol].sequence
```

A delta is applied **only** when:

```text
delta.previousSequence === localBook[delta.symbol].sequence
```

Otherwise:

```text
RESYNC
```

No patching. No interpolation. No "it's probably fine". A gap means the local book is unknown, and
the only honest recovery is a fresh snapshot.

**Enforced at**

| Where | How |
| --- | --- |
| Server, `OrderBook` | `bookSequence` increments by exactly 1 per emitted delta, per symbol ([02 §7](./02-market-domain.md#7-order-book-sequencing)) |
| Server, backpressure | Book deltas are never dropped; an unrecoverable backlog closes the socket ([03 §9](./03-adaptive-delivery.md#9-backpressure)) |
| Client, `OrderBookSynchronizer` | Buffer-then-snapshot algorithm, gap → `RESYNCING`; one synchroniser per symbol ([04 §5](./04-frontend.md#5-order-book-synchronisation)) |
| Client, symbol switch | Late snapshots and deltas rejected by `symbol` before merge ([04 §6](./04-frontend.md#6-symbol-switching)) |
| Client, long hidden tab | Hard refresh after `30s` rather than trusting a suspended tab ([04 §12](./04-frontend.md#12-browser-visibility)) |

**Proven by** T2, T4, T6, and the Playwright drop-a-delta flow ([05](./05-testing.md)).

---

## I2 — Candle invariance

For a given trade stream:

```text
FinalCandle(FULL)
=
FinalCandle(DEGRADED)
=
FinalCandle(MINIMAL)
```

Tier affects **delivery frequency only**.

**Enforced at**

| Where | How |
| --- | --- |
| Domain | Exactly one `CandleAggregator` per symbol per interval, fed by canonical trades, with no tier awareness ([02 §8](./02-market-domain.md#8-candle-engine)) |
| Delivery | Per-connection scheduler paces sends; finalised candles queue and are never dropped, active candles coalesce ([03 §2](./03-adaptive-delivery.md#2-delivery-scheduler)) |
| Architecture | Tiering sits downstream of the event bus, never inside the pipeline ([00 §1](./00-architecture.md#1-system-diagram)) |

**Proven by** T3 — 10,000 deterministic trades, three virtual clients, `toEqual` on the final
candle sets ([05](./05-testing.md#t3--candle-equality-across-tiers)).

**Corollary worth saying out loud:** the tier targets are *maximum delivery frequencies*. We never
invent trades to hit a rate. Tier is connection-scoped — one socket has one tier across every
symbol it holds — while the delivery schedule is kept per symbol.

---

## I3 — Event ordering

Never trust arrival-timestamp ordering.

Authoritative ordering identifiers:

```text
tradeId
bookSequence
lastTradeId
```

- `tradeId` is strictly increasing **within its symbol** and orders that symbol's trade stream.
- `bookSequence` orders that symbol's book mutations and is independent of `tradeId`.
- `lastTradeId` on a candle resolves which of two versions of the same candle is newer.

None of these are comparable **across** symbols. Comparing `BTC-USD` sequence 15291 with `SOL-USD`
sequence 15291 is meaningless — they are unrelated counters that happen to collide.

Timestamps are for humans and for candle bucketing. They are not identity and they are not order.
Clocks adjust, batches arrive together, and two events can share a millisecond.

**Enforced at**

| Where | How |
| --- | --- |
| Protocol | Ids are decimal strings of `bigint`, never elided; every frame carries `symbol` ([01 §3](./01-protocol.md#3-value-encoding)) |
| Client merge | History/realtime dedupe by `symbol + interval + candleStart`, conflict resolved by higher `lastTradeId` ([04 §9](./04-frontend.md#9-chart-adapter)) |
| Client book | Applies by `previousSequence`, not by arrival ([04 §5](./04-frontend.md#5-order-book-synchronisation)) |

**Proven by** T2, T4, T6, and the duplicate-candle test in P11.

---

## If you are about to break one

Stop. Surface it. There is no version of this project where a shipped feature is worth a broken
invariant — the invariants are the entire point of the exercise.
