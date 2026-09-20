# 08 — Glossary

| | |
| --- | --- |
| **Audience** | Anyone hitting an unfamiliar term |
| **Read this when** | A word in another doc is doing more work than it looks like |
| **Depends on** | Nothing |

Terms are used precisely throughout this repo. If code and glossary disagree, one of them is wrong.

| Term | Meaning |
| --- | --- |
| **Active candle** | The candle for the bucket currently in progress. `final: false`. Mutates on every trade; coalesced during delivery. |
| **Authoritative / canonical** | The single server-side truth, computed once from 100% of trades, identical for every client. Contrast: per-connection delivery state. |
| **`autoTier`** | The tier the `TierController` computed from RTT + jitter. Keeps updating even while an override is active. |
| **`AUTH_MODE`** | `ticket` (every deployed environment) or `off` (local dev only). Gates the whole connect-ticket mechanism. |
| **Backpressure** | Outbound socket buffer growing faster than it drains, observed via `bufferedAmount`. Policy per stream in [03 §9](./03-adaptive-delivery.md#9-backpressure). |
| **`bookSequence`** | Monotonic counter for order-book mutations, +1 per emitted delta. **Per symbol**, and independent of `tradeId`. Not comparable across symbols. |
| **Channel** | A per-symbol subscription stream: `book`, `trades`, or `candles`. Requested independently in `subscribe`. |
| **Coalesce** | Replace a queued item with a newer version instead of queueing both. Applied to the active candle, never to finalised candles or deltas. |
| **Delta** | An incremental order-book update carrying `previousSequence` and `sequence`. Quantity `0` deletes a level. |
| **`DEGRADED`** | Middle tier, 2 Hz. Also the tier every new connection starts in. |
| **Demotion** | Moving a connection to a slower tier. Needs 3 consecutive bad reports; triggers on OR. |
| **`effectiveTier`** | The tier actually used for delivery — the override if one is set, otherwise `autoTier`. |
| **Close code** | WebSocket close status carrying the reason: `4401` unauthorized, `4408` ticket expired/replayed, `4429` rate-limit abuse, `4409` backpressure, `4000` heartbeat timeout. An `error` frame always precedes it. |
| **EWMA** | Exponentially weighted moving average, `α = 0.2`, used for both RTT and jitter on the client. |
| **`final`** | Flag on a candle meaning its bucket has closed and its values will never change again. |
| **Fixed-point** | Integer representation of a decimal value at a known scale. Price scale `4`, quantity scale `8`, held as `bigint`. |
| **`FULL`** | Fastest tier, 10 Hz. Earned, never assumed. |
| **Gap** | `delta.previousSequence !== localBook.sequence`. Always means resync, never means repair. |
| **Hysteresis** | Using different thresholds and confirmation counts for promotion vs demotion so the tier does not flap. [03 §5](./03-adaptive-delivery.md#5-hysteresis). |
| **Jitter** | EWMA of `abs(currentRTT - previousRTT)`. Variability, not latency. |
| **`lastTradeId`** | The id of the most recent trade folded into a candle. Tie-breaker when two versions of a candle meet. |
| **Logical tick** | One 50 ms step of simulated market time. Every symbol engine advances exactly once per tick, regardless of when the wall clock got around to it. One clock drives all five. |
| **`MINIMAL`** | Slowest tier, 0.5 Hz. Still receives every finalised candle. |
| **Override** | A client-requested forced `effectiveTier` via `debug.tier_override`. Does not stop measurement, does not change `autoTier`. |
| **`pendingFinalCandles`** | Per-connection queue of closed candles not yet delivered. Accumulates; never coalesced, never dropped. |
| **Promotion** | Moving a connection to a faster tier. Needs 5 consecutive good reports; requires AND on both metrics. |
| **Rate-limit strike** | A `RATE_LIMITED` response. Three within 10 s closes the socket with `4429`. |
| **Resync** | Discard local book confidence, re-buffer deltas, fetch a fresh snapshot, replay. The only response to a gap. Scoped to **one symbol**. |
| **RTT** | Round-trip time of an application-level `ping`/`pong`, measured with `performance.now()`. Explicitly *not* a one-way latency estimate. |
| **`sub`** | Opaque anonymous id inside a ticket payload. The rate-limit key. Not a user; nothing is stored about it. |
| **Symbol registry** | The five configured markets — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — with per-symbol tick size, base price, and character. Served by `GET /v1/markets`; never hardcoded client-side. |
| **`SymbolEngine`** | One symbol's complete world: derived PRNG seed, generator, order book, `tradeId` counter, and three candle aggregators. Shares nothing with its siblings. |
| **`SymbolSubscription`** | Per-connection, per-symbol delivery state: channels, interval, pending finalised candles, coalesced active candle, pending trades. Tier is *not* here — it lives on the session. |
| **Snapshot** | Full order-book state at a stated `sequence`. The anchor for client synchronisation. |
| **`STALE`** | UI state: data is still on screen and still the last known truth, but it is no longer live. Never blank instead. |
| **`SYNCING` / `SYNCHRONIZED` / `RESYNCING`** | `bookStatus` values. `SYNCHRONIZED` is the only one where the local book is trustworthy. |
| **Ticket** | Short-lived (`60s`), single-use, HMAC-signed string that authorises **one** WebSocket connect. Fetched from `POST /v1/auth/ticket` and passed as `?ticket=`. Authorises the connect, not the session — the socket outlives its `exp`. |
| **Tier** | Per-**connection** delivery frequency class: `FULL` / `DEGRADED` / `MINIMAL`. Affects cadence of `candles.update` and `trades.batch` only, never content, and never book deltas. One tier covers all of a connection's symbols. |
| **`tradeId`** | Strictly increasing trade identifier **within its symbol**. The authoritative ordering key for that symbol's trade stream. Meaningless across symbols. |
| **Token bucket** | Rate-limiter primitive: a sustained refill rate plus a burst capacity, one per frame type plus a global bucket. [`01-protocol.md §8`](./01-protocol.md#8-rate-limiting). |
| **Virtual client** | In-process `ConnectionSession` + scheduler with a fake socket and fake clock, used by tests T3 and T6. |
