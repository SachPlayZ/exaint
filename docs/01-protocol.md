# 01 — Protocol

| | |
| --- | --- |
| **Audience** | Anyone adding or changing a wire message, on either side |
| **Read this when** | You touch `packages/protocol`, a route handler, or a socket frame |
| **Depends on** | [`00-architecture.md`](./00-architecture.md), [`02-market-domain.md`](./02-market-domain.md) for value semantics |

Examples marked **normative** are the contract. Examples marked *illustrative* show shape only.

---

## 1. Ownership

`packages/protocol` owns the contract. Both apps import `@repo/protocol`. Nothing else crosses the
app boundary.

```text
packages/protocol/src/
├── market.ts      Symbol, Trade, BookSnapshot, BookDelta, Candle, Interval, Tier, NetworkReport
├── rest.ts        REST request params + response shapes
├── websocket.ts   every client and server frame, discriminated on `type`
├── auth.ts        ticket payload + close codes
└── schemas.ts     Zod schemas; TS types via z.infer — never hand-written twice
```

Rule: **the Zod schema is the definition.** Types are inferred from it. If you find yourself
writing an interface next to a schema, you have introduced a divergence.

---

## 2. Symbols

Five symbols, served by five independent engines
([`02-market-domain.md §2`](./02-market-domain.md#2-symbol-registry)):

```text
BTC-USD    ETH-USD    SOL-USD    HYPE-USD    ZEC-USD
```

Configured by `MARKET_SYMBOLS`. `BTC-USD` is the UI default.

**Every symbol is its own world.** `tradeId`, `bookSequence`, the order book, and the candle
aggregators are per-symbol and completely independent. There is no global sequence and no global
trade counter. A client resyncing `ETH-USD` does not touch its `BTC-USD` state.

Every market frame — REST and WS — carries `symbol`. It is never implied by connection or context.

### `GET /v1/markets`

**Normative:**

```json
{
  "serverTime": 1789874705123,
  "symbols": [
    {
      "symbol": "BTC-USD",
      "priceScale": 4,
      "quantityScale": 8,
      "tickSize": "0.1000",
      "bookDepth": 25
    }
  ]
}
```

The client fetches this once at boot and drives the symbol switcher from it. Do not hardcode the
symbol list in the frontend.

---

## 3. Value encoding

JSON cannot carry `bigint`, and floats cannot carry money. Therefore:

| Domain value | Internal | On the wire |
| --- | --- | --- |
| Price | `bigint`, scale `4` | decimal string — `"67231.4287"` |
| Quantity | `bigint`, scale `8` | decimal string — `"0.03124500"` |
| `tradeId` | `bigint`, per symbol | decimal string — `"934821"` |
| `sequence` | `bigint`, per symbol | decimal string — `"15291"` |
| Timestamp | `number` (ms epoch) | `number` |

Price scale `4` and quantity scale `8` are **uniform across all symbols** — only `tickSize` varies.
That keeps one codec for the whole system.

Quantity strings keep their trailing zeros — the scale is part of the contract, so `"0.03124500"`
is not normalised to `"0.031245"`. Codecs live in `packages/protocol` and have their own tests.

See [`02-market-domain.md §5`](./02-market-domain.md#5-numeric-precision) for why.

---

## 4. REST

Base path `/v1`. All responses `application/json`. CORS restricted to `ALLOWED_ORIGINS`.

### `POST /v1/auth/ticket`

Mints a short-lived connect ticket. See §7.

### `GET /v1/markets`

Symbol registry — §2.

### `GET /v1/markets/:symbol/book`

Order-book snapshot with the sequence it was taken at. This is the anchor for client
synchronisation. The sequence is **that symbol's** sequence.

**Normative:**

```json
{
  "symbol": "BTC-USD",
  "sequence": "15291",
  "bids": [
    ["67231.1000", "0.30210000"]
  ],
  "asks": [
    ["67231.5000", "0.20130000"]
  ]
}
```

Levels are `[price, quantity]` tuples. Bids descend, asks ascend. `25` levels per side.

### `GET /v1/markets/:symbol/candles`

```http
GET /v1/markets/BTC-USD/candles
    ?interval=1s
    &limit=300
```

- `interval` ∈ `1s | 5s | 1m`
- `limit` clamped server-side; document the clamp in the README

**Normative:**

```json
{
  "symbol": "BTC-USD",
  "interval": "1s",
  "serverTime": 1789874705123,
  "candles": []
}
```

Guarantees on `candles`:

- sorted ascending by `startTime`
- unique by `startTime` — no duplicates, ever
- contains **completed history plus the canonical current candle**, the last one marked
  `"final": false`

Returning the active candle is a deliberate choice: it makes client bootstrapping simpler, because
the chart can render immediately and then transition to `series.update()` without a seam. It is
documented rather than implicit.

### Health and metrics

```http
GET /healthz     liveness
GET /readyz      readiness — every symbol engine has produced its first tick
GET /metrics     counters, see 06-ops-deploy.md
```

### REST rate limits

| Route | Limit |
| --- | --- |
| `POST /v1/auth/ticket` | 60 req/min per IP |
| market reads (`/v1/markets/**`) | 120 req/min per IP |
| health / metrics | unlimited |

Exceeded → `429` with `{"code":"RATE_LIMITED","retryAfterMs":…}`.

---

## 5. WebSocket

Endpoint is **explicitly versioned**, and requires a ticket:

```text
/v1/ws?ticket=<ticket>
```

Every message, both directions, has a `type` discriminator:

```ts
{
  type: string
}
```

### Client → server

| `type` | Purpose |
| --- | --- |
| `subscribe` | Start receiving named channels for a symbol |
| `unsubscribe` | Stop |
| `set_interval` | Change the candle interval for a subscribed symbol |
| `ping` | Application-level latency probe (**not** TCP ping) |
| `network.report` | Client's measured RTT and jitter |
| `debug.tier_override` | Force an effective tier, or return to automatic |

### Server → client

| `type` | Purpose |
| --- | --- |
| `hello` | Connection id, server time, initial tier, protocol version, symbol registry |
| `subscribed` | Acknowledgement of a subscription change |
| `pong` | Echo of a `ping`, with the same `id` |
| `trades.batch` | Batched recent trades, one symbol per frame |
| `book.delta` | Order-book increment, one symbol per frame |
| `candles.update` | Finalised and/or active candles, one symbol + interval per frame |
| `tier.changed` | This connection's tier changed |
| `error` | Rejected input or server-side condition |

### Validation

**Every** inbound frame is parsed with Zod before anything touches it. Unknown or malformed input
produces:

```json
{
  "type": "error",
  "code": "INVALID_MESSAGE"
}
```

The connection **survives**. Malformed input must never crash a connection handler and must never
take down the process. This is tested with fuzzed garbage in P5.

### Error codes

Extend deliberately, never ad hoc.

| Code | Meaning |
| --- | --- |
| `INVALID_MESSAGE` | Failed schema validation |
| `UNKNOWN_TYPE` | `type` not in the client set |
| `UNKNOWN_SYMBOL` | Symbol not in `MARKET_SYMBOLS` |
| `INVALID_INTERVAL` | Interval not in `1s \| 5s \| 1m` |
| `INVALID_CHANNEL` | Channel not in `book \| trades \| candles` |
| `NOT_SUBSCRIBED` | `set_interval` for a symbol this connection has not subscribed to |
| `TOO_MANY_SUBSCRIPTIONS` | Per-connection symbol cap exceeded (§8) |
| `RATE_LIMITED` | Frame dropped by the rate limiter (§8) |
| `UNAUTHORIZED` | Ticket missing, malformed, or signature invalid (§7) |
| `TICKET_EXPIRED` | Ticket past `exp`, or already used (§7) |
| `BACKPRESSURE_CLOSE` | Outbound book stream unrecoverable — socket closing, resync on reconnect |

### Close codes

Sent as the WebSocket close status so the client can react without parsing a frame.

| Code | Meaning | Client reaction |
| --- | --- | --- |
| `4401` | Unauthorized | Fetch a new ticket, then reconnect |
| `4408` | Ticket expired / replayed | Fetch a new ticket, then reconnect |
| `4429` | Rate limit abuse | Reconnect with backoff, do not retry immediately |
| `4409` | Backpressure close | Reconnect and take a fresh snapshot |
| `4000` | Heartbeat timeout (45 s) | Normal reconnect |

An `error` frame is always sent **before** the close, so the reason is visible in both places.

---

## 6. Message reference

### `subscribe`

*Illustrative:*

```json
{
  "type": "subscribe",
  "symbol": "SOL-USD",
  "channels": ["book", "trades", "candles"],
  "interval": "1s"
}
```

Channels are independent: a connection may take `trades` for one symbol and all three for another.
`interval` is required when `candles` is requested, and is **per symbol** — two symbols on one
connection may sit on different intervals.

### `trade` (domain shape, carried inside `trades.batch`)

**Normative:**

```json
{
  "type": "trade",
  "symbol": "BTC-USD",
  "tradeId": "183192",
  "timestamp": 1789874705123,
  "side": "buy",
  "price": "67231.4287",
  "quantity": "0.03124500"
}
```

`tradeId` is **strictly increasing within its symbol**. It gives unambiguous ordering independent of
timestamps. Do not compare a `tradeId` across symbols — they are separate counters. Do not use
timestamps as ordering ids — see [`07-invariants.md` I3](./07-invariants.md#i3--event-ordering).

### `trades.batch`

The backend processes every trade internally but emits them batched. **Batch cadence is
tier-scaled** — see [`03-adaptive-delivery.md §2`](./03-adaptive-delivery.md#2-delivery-scheduler).

```json
{
  "type": "trades.batch",
  "symbol": "BTC-USD",
  "trades": []
}
```

Rationale: React should not be asked to render 30 individual trade messages per second. The client
keeps only the latest `50` per symbol. Result is a much smoother UI.

### `book.delta`

**Normative:**

```json
{
  "type": "book.delta",
  "symbol": "BTC-USD",
  "previousSequence": "15291",
  "sequence": "15292",
  "timestamp": 1789874705142,
  "bids": [
    ["67230.9000", "0.50000000"]
  ],
  "asks": [
    ["67232.0000", "0"]
  ]
}
```

- Quantity `"0"` means **delete this price level**.
- `previousSequence` exists so gap detection is trivial and local: a client compares it against its
  own current sequence **for that symbol** and knows instantly whether it missed something.

`bookSequence` is per symbol and maintained independently of `tradeId`. Separate counters, separate
meanings, separate symbols.

### `candles.update`

Carries zero or more finalised candles plus at most one active candle, for one symbol and one
interval. A Minimal client receiving one update every two seconds can still see every `1s` candle
that closed in between.

*Illustrative:*

```json
{
  "type": "candles.update",
  "symbol": "BTC-USD",
  "interval": "1s",
  "candles": [
    {
      "start": 1789874704000,
      "final": true,
      "...": "..."
    },
    {
      "start": 1789874705000,
      "final": false,
      "...": "..."
    }
  ]
}
```

Full candle field list: [`02-market-domain.md §8`](./02-market-domain.md#8-candle-engine).
Delivery rules: [`03-adaptive-delivery.md §2`](./03-adaptive-delivery.md#2-delivery-scheduler).

### `ping` / `pong`

*Illustrative:*

```json
{ "type": "ping", "id": "1192" }
```

```json
{ "type": "pong", "id": "1192" }
```

The server replies **immediately** — no queueing behind data frames, or the measurement is
meaningless. `ping` is connection-scoped, not symbol-scoped.

### `network.report`

*Illustrative:*

```json
{
  "type": "network.report",
  "rttMs": 82.4,
  "jitterMs": 11.8,
  "samples": 12
}
```

Sent every `5s`. This is **round-trip** latency. It is not an attempt to estimate one-way latency.
Say that explicitly in the README.

### `debug.tier_override`

*Illustrative:*

```json
{ "type": "debug.tier_override", "tier": "minimal" }
```

```json
{ "type": "debug.tier_override", "tier": null }
```

`null` returns the connection to automatic. Tier is **connection-scoped**, never per symbol — one
socket, one tier, all its symbols. Semantics — including the fact that measurement continues while
overridden — are in [`03-adaptive-delivery.md §7`](./03-adaptive-delivery.md#7-debug-override).

Gated by `ENABLE_DEBUG_CONTROLS`.

### `tier.changed`

Emitted whenever `effectiveTier` changes, so the UI never has to infer it. Carries `autoTier`,
`override`, `effectiveTier`, the reason (`hysteresis` / `override` / `missing_reports`), and the
target cadences.

---

## 7. Authentication

Connections require a short-lived **ticket**. This is not user auth — there are no accounts. It
stops the deployed demo from being an open firehose anyone can point a script at, and it gives the
server a place to attach per-client identity for rate limiting.

### Why a ticket and not a header

Browsers cannot set arbitrary headers on a `WebSocket` handshake. The options are a subprotocol
hack, a cookie, or a query parameter. A short-lived single-use ticket in the query string is the
honest one: it is scoped, it expires in `60s`, and leaking it from a log buys an attacker almost
nothing. Rationale in full: [`adr/0007-ws-auth-ticket.md`](./adr/0007-ws-auth-ticket.md).

### Flow

```text
1. POST /v1/auth/ticket          → { ticket, expiresAt }
2. wss://api/v1/ws?ticket=<t>
3. server verifies signature, exp, not-already-used
4. server marks ticket used, sends `hello`
5. ticket is now irrelevant — the socket outlives it
```

**Normative** response:

```json
{
  "ticket": "eyJzdWIiOiJhbm9uLTdmM2EiLCJpYXQiOjE3ODk4NzQ3MDUxMjMsImV4cCI6MTc4OTg3NDc2NTEyM30.8Qk2...",
  "expiresAt": 1789874765123
}
```

Format is `base64url(payload) "." base64url(HMAC-SHA256(payload, AUTH_TICKET_SECRET))`.

Payload:

```json
{
  "sub": "anon-7f3a91c2",
  "iat": 1789874705123,
  "exp": 1789874765123
}
```

### Rules

- TTL `60s` (`AUTH_TICKET_TTL_MS`). Long enough to survive a slow page load, short enough that a
  leaked ticket is worthless.
- **Single use.** The server keeps a TTL-bounded set of consumed ticket ids; a replay is rejected
  with `TICKET_EXPIRED` and close `4408`.
- The **ticket authorises the connect, not the session.** Once connected, expiry is irrelevant —
  the socket is not torn down at `exp`. Heartbeat governs liveness, not the ticket.
- **Every reconnect needs a fresh ticket.** The client fetches one before each attempt, inside the
  backoff ([`04-frontend.md §11`](./04-frontend.md#11-disconnect-and-reconnect)).
- `sub` is an opaque anonymous id minted per ticket request. It is the rate-limit key. It is not a
  user, and nothing is stored about it.
- `AUTH_MODE=off` disables the whole mechanism for local development. It is `ticket` everywhere
  else, including the demo deployment.

---

## 8. Rate limiting

Per-connection token buckets, one per frame type plus a global bucket. Exceeding a bucket **drops
that frame** and replies `RATE_LIMITED`. The connection survives — a burst is usually a bug, not an
attack.

| Frame | Sustained | Burst |
| --- | ---: | ---: |
| `ping` | 2 / s | 4 |
| `network.report` | 1 / s | 3 |
| `subscribe` / `unsubscribe` | 5 / s | 10 |
| `set_interval` | 5 / s | 10 |
| `debug.tier_override` | 2 / s | 5 |
| **any frame (global)** | 20 / s | 40 |

Sustained abuse — **3 `RATE_LIMITED` responses within 10 s** — closes the socket with `4429`. The
client then reconnects with backoff, which is the correct behaviour for a genuinely broken client
and an adequate deterrent for a hostile one.

Other per-connection caps:

| Cap | Value | On breach |
| --- | ---: | --- |
| Symbols subscribed | 5 | `TOO_MANY_SUBSCRIPTIONS` |
| Inbound frame size | 8 KiB | `INVALID_MESSAGE` |

Budgets are generous against documented client behaviour — a well-behaved client sends one `ping`
every `2s` and one `network.report` every `5s`, which is an order of magnitude under the limit.
A client that trips these is misbehaving.

---

## 9. Versioning

The path carries the version (`/v1/ws`, `/v1/...`). A breaking change means `/v2`, not a silent
field change. Additive optional fields are not breaking; renamed or retyped fields are.

---

## Open questions

- A `ticker` channel — last price + top-of-book for *all* symbols at a low fixed rate, to drive
  live prices in the symbol switcher. Deferred, not rejected: it is a product nicety, and the
  switcher works without it. Revisit after P10 if time allows.
- Should `subscribe` accept multiple symbols in one frame? *(assumed: one symbol per frame; the
  cap is 5 subscriptions, so at worst that is 5 frames at boot)*
