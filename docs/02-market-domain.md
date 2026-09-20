# 02 — Market Domain

| | |
| --- | --- |
| **Audience** | Whoever builds or changes the simulator, order book, or candle engine |
| **Read this when** | You touch `apps/api/src/market/**` |
| **Depends on** | [`07-invariants.md`](./07-invariants.md); wire encoding in [`01-protocol.md`](./01-protocol.md) |

This layer knows nothing about Fastify, WebSockets, tiers, auth, or clients. It produces canonical
markets. Everything else consumes them.

---

## 1. What "canonical" means here

For **each symbol** there is exactly one order book, one trade stream, and one set of candle
aggregators in the process. Every client is served from that state. No per-client recomputation
exists anywhere in this layer — see [`07-invariants.md` I2](./07-invariants.md#i2--candle-invariance).

---

## 2. Symbol registry

Five symbols, five fully independent engines:

| Symbol | Base price | Tick size | Typical trade size | Character |
| --- | ---: | ---: | --- | --- |
| `BTC-USD` | `67231.4287` | `0.1000` | `0.001 – 1` | deep book, tight spread |
| `ETH-USD` | `3512.8400` | `0.0100` | `0.01 – 20` | deep book, tight spread |
| `SOL-USD` | `214.3900` | `0.0010` | `0.1 – 500` | livelier, wider spread |
| `HYPE-USD` | `38.7200` | `0.0010` | `1 – 2000` | most volatile, thinnest book |
| `ZEC-USD` | `347.5100` | `0.0100` | `0.1 – 300` | moderate, occasional gaps |

Configured by `MARKET_SYMBOLS`. Price scale `4` and quantity scale `8` are **uniform** — only
`tickSize`, base price, size distribution, and volatility vary. One codec, five personalities.

### Calibration

The "Character" column above is qualitative; these are the numbers that produce it, chosen in P2
and owned by `apps/api/src/market/symbol-config.ts`.

| Symbol | Level spacing | Spread | Volatility / tick | Resting size / level |
| --- | ---: | ---: | ---: | --- |
| `BTC-USD` | `4.0000` | 1 spacing | `1.5000` | `0.05 – 1.5` |
| `ETH-USD` | `0.2100` | 1 spacing | `0.0790` | `0.5 – 25` |
| `SOL-USD` | `0.0210` | 2 spacings | `0.0158` | `5 – 350` |
| `HYPE-USD` | `0.0080` | 3 spacings | `0.0120` | `25 – 900` |
| `ZEC-USD` | `0.0400` | 2 spacings | `0.0225` | `3 – 200` |

- **Level spacing** is the gap between two *displayed* levels, always a whole multiple of
  `tickSize`. The ladder is a grid. Twenty-five adjacent ticks on `BTC-USD` would span `2.50` —
  a third of a basis point — so the whole book would be rewritten several times a second and no
  reviewer could read it. Grouping to `4.0000` gives 25 levels spanning ~15 bp, which persists for
  seconds and still moves. Trades still print at any multiple of `tickSize`.
- **Volatility** is the largest fair-value step per logical tick, and is ~⅛ of the level spacing,
  so the fair value crosses a grid step every few ticks. The book breathes rather than being
  rebuilt.
- **Thinness** is the ratio of resting size to trade size. `BTC-USD` and `ETH-USD` absorb a typical
  trade inside one level; `HYPE-USD` does not. That is what "thinnest book" means here.

Measured over one simulated minute from `MARKET_SEED=1337` (asserted in
`apps/api/tests/market/simulator.test.ts`):

```text
BTC-USD    spread 0.59 bp    1-min range  3.0 bp
ETH-USD    spread 0.59 bp    1-min range  2.4 bp
SOL-USD    spread 1.95 bp    1-min range 11.7 bp
ZEC-USD    spread 2.30 bp    1-min range  9.2 bp
HYPE-USD   spread 6.18 bp    1-min range 26.8 bp
```

The visible ladder stays **contiguous on the grid**: every adjacent pair of displayed levels is
exactly one `levelSpacing` apart, on both sides, at all times. Replenishment fills empty slots from
the touch outward rather than extending from the far edge — extending outward alone lets the touch
migrate with the fair value while the old cluster stays put, and the book degenerates into a lonely
best level above a stale block. Asserted in `apps/api/tests/market/simulator.test.ts`.

The differing character is deliberate: five identical random walks at different price levels looks
like one symbol rendered five times. A reviewer switching from `BTC-USD` to `HYPE-USD` should
immediately see a different market.

### Independence

Per symbol, with **nothing shared**:

```text
SymbolEngine
├── PRNG stream        (seed derived from MARKET_SEED + symbol)
├── logical clock      (same 50ms tick, independent tick counter)
├── order book         (own bookSequence)
├── tradeId counter
└── candle aggregators (1s / 5s / 1m)
```

There is **no global sequence and no global trade counter**. `BTC-USD` at `bookSequence 15291` and
`SOL-USD` at `bookSequence 88240` are unrelated facts. A resync on one symbol never touches
another.

`SymbolRegistry` owns the map and is the only thing that knows more than one symbol exists.

### Seed derivation

```text
symbolSeed = splitmix64(MARKET_SEED ⊕ fnv1a(symbol))
```

One `MARKET_SEED` still reproduces the entire five-symbol universe exactly. Streams are independent,
so a change to `ETH-USD`'s generator cannot perturb `BTC-USD`'s replay — which is what keeps the
determinism tests stable as the simulator evolves.

---

## 3. Deterministic PRNG

Do not write:

```ts
price += Math.random() * 100 - 50
```

That is a toy, and reviewers read it as one.

Use a seeded deterministic PRNG — PCG or xorshift. Seed from the environment:

```bash
MARKET_SEED=1337
```

Tests pin both seed and start time:

```ts
seed = 1
startTime = 1_700_000_000_000
```

so the exact event stream is reproducible byte for byte, for every symbol.

**Demo mode** separates the two axes:

```text
absolute timestamp = application start time
random sequence    = deterministic from seed
```

Timestamps look live; price movement stays reproducible.

---

## 4. Logical market clock

Market correctness must not depend on `setInterval()` actually firing every 50ms. It will not.

```text
logical tick = 50ms
```

Each symbol engine advances state **exactly once per logical step**:

```text
tick 0
tick 1
tick 2
tick 3
...
```

The wall-clock scheduler's only job is to ask:

> "How many logical ticks should have been processed by now?"

…and then run that many, for every symbol, in registry order. An event-loop stall changes *when*
ticks are processed, never *which* ticks occur or in what order. This is what makes determinism
survive a loaded machine, and what makes the replay tests meaningful.

One scheduler drives all five engines. Five `setInterval`s would give five drifting clocks.

### Bounded catch-up

`MarketEngine.runOwedTicks` runs at most `MARKET_MAX_CATCHUP_TICKS` (default `200`, ten seconds of
market time) in a single pass, so one long stall cannot block the event loop while it replays.

Nothing is skipped. The remainder stays owed and is caught up on the next pass, which is what keeps
the stream intact — a market that dropped ticks under load would not be deterministic, and the
replay tests would be measuring nothing. A sixty-second freeze clears over six passes, roughly
300 ms.


---

## 5. Numeric precision

Never calculate money in JS floating point.

Domain values are fixed-point integers held as `bigint`:

```text
price scale    = 4
quantity scale = 8
```

So:

```text
67231.4287 USD
```

is

```ts
672314287n
```

and:

```text
0.03124500 BTC
```

is

```ts
3124500n
```

Boundaries:

- **JSON boundary** → decimal strings (`"67231.4287"`, `"0.03124500"`, `"934821"`).
  JSON cannot encode `bigint`; a stray `bigint` in `JSON.stringify` is a runtime `TypeError`.
- **Chart boundary** → convert price to a JS `number`, because Lightweight Charts expects numeric
  chart values. **That converted number is never used for a canonical calculation.** It is display
  output and nothing else.

All accumulation — volume especially — happens in `bigint`. See
[`adr/0002-fixed-point-bigint.md`](./adr/0002-fixed-point-bigint.md).

---

## 6. Market plausibility

Per symbol, maintain:

```text
mid price
best bid
best ask
25 levels each side      (MARKET_BOOK_DEPTH)
```

`25` is the chosen depth: enough to fill the panel and make cumulative depth bars meaningful, small
enough that a resync is cheap and the delta rate stays sane.

Shape:

```text
BTC-USD

Ask
67,232.10   0.084
67,231.90   0.246
67,231.70   0.411
------------------
67,231.50   ← spread
------------------
67,231.30   0.121
67,231.10   0.552
67,230.90   0.832
Bid
```

Simulate three event kinds:

1. **New limit order** — adds liquidity at a level
2. **Cancellation / update** — removes or resizes a level
3. **Market trade** — consumes liquidity

```text
buy trade  → consumes asks
sell trade → consumes bids
```

When levels deplete, replenish liquidity **further from the mid**. Occasionally perturb liquidity so
the book is visually interesting rather than a static ladder. Per-symbol volatility and depth
parameters come from the registry table in §2.

This is not a full matching engine and does not need to be. What it does need: trades and the book
must have a **coherent relationship**. A buy print at a price no ask ever offered is a bug a
reviewer will spot in five seconds.

---

## 7. Order book sequencing

`bookSequence` is an independent monotonic counter **per symbol**, separate from `tradeId`.

- It increments by exactly 1 per emitted delta, for that symbol.
- A snapshot carries the sequence it was taken at.
- A delta carries both `previousSequence` and `sequence`.
- Quantity `0` on a level means **delete**.

Wire shapes: [`01-protocol.md §6`](./01-protocol.md#6-message-reference).

The server's job is to emit an unbroken chain per symbol. The client's job is to detect any break
and resync **that symbol only** — that algorithm lives in
[`04-frontend.md §5`](./04-frontend.md#5-order-book-synchronisation), because it is client-side
logic.

---

## 8. Candle engine

Three intervals, per symbol:

```text
1s
5s
1m
```

Two would satisfy the requirement; three makes the product materially better to demonstrate.

Every canonical trade fans out to every aggregator **for its symbol**:

```text
Trade (BTC-USD)
 ├──► BTC-USD 1s aggregator
 ├──► BTC-USD 5s aggregator
 └──► BTC-USD 1m aggregator
```

Fifteen aggregators total. A trade never touches another symbol's aggregators.

### Candle shape

```ts
{
  symbol,
  startTime,
  open,
  high,
  low,
  close,
  volume,
  tradeCount,
  lastTradeId
}
```

`lastTradeId` is what makes two versions of the same candle comparable — the higher one wins during
history/realtime merge. It is not decoration.

On the wire the candle carries one extra field, `final` — `false` while the bucket is still open.
The engine does not store it; finality is a fact about the clock, and the transport states it so the
client never has to infer it ([`01-protocol.md §6`](./01-protocol.md#candlesupdate)).

### Bucket boundary

```ts
candleStart =
  Math.floor(trade.timestamp / intervalMs) *
  intervalMs
```

### Update rules

```text
open   = first trade
high   = max(...)
low    = min(...)
close  = newest trade
volume = exact sum of quantities
```

Again: fixed-point `bigint` math. A float `+=` on volume across 10,000 trades drifts, and test T3
will catch it — after you have wasted an hour.

### Storage

Ring buffer per symbol per interval, sized for `limit=300` plus headroom. Finalisation emits an
event when a bucket closes; the delivery layer decides who hears about it and when.

### What this engine must not do

```text
Trade Generator
   ├── Full candle calculator       ❌
   ├── Degraded candle calculator   ❌
   └── Minimal candle calculator    ❌
```

Correct:

```text
                    Canonical Candle Engine (per symbol)
                                  │
                     candle state / updates
                                  │
          ┌───────────────────────┼─────────────────────┐
          ▼                       ▼                     ▼
      Connection A           Connection B          Connection C
        FULL                  DEGRADED               MINIMAL
```

One engine per symbol, one scheduler per connection. That is what guarantees final OHLCV equality.

---

## 9. Event bus

`MarketEngine` owns the tick loop and drives every `SymbolEngine`. `MarketEventBus` fans the
resulting events out to REST (`MarketRepository`) and the WebSocket gateway, tagged by symbol. The
bus is the last point that is tier-unaware and client-unaware; everything downstream of it may be
per-connection.

---

**Resolved:** catch-up is bounded per pass by `MARKET_MAX_CATCHUP_TICKS` (§4), with no tick
skipped.

## Open questions

- Should the simulator model correlated moves across symbols — a market-wide risk-off tick — or
  keep the five streams fully independent? *(assumed: independent; correlation is a nice demo
  touch with no bearing on any invariant, so it is the first thing cut for time)*
- Regime switching (occasional wide-spread / thin-book phases)? *(assumed: light per-symbol
  perturbation only, no explicit regimes)*
