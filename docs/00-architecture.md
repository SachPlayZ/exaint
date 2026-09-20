# 00 — Architecture

| | |
| --- | --- |
| **Audience** | Anyone onboarding, or making a structural change |
| **Read this when** | You need the system shape, module boundaries, or the repo layout |
| **Depends on** | Nothing. This is the entry point. |

---

## 1. System diagram

```text
                 ┌──────────────────────────────────────┐
                 │ SymbolRegistry — one engine each     │
                 │ BTC · ETH · SOL · HYPE · ZEC         │
                 │ seed derived per symbol              │
                 └──────────────────┬───────────────────┘
                                    │
                   one logical clock, 50ms tick, drives all
                                    │
             ┌──────────────────────┴───────────────────────┐
             │           per symbol, independent            │
             ▼                                              ▼
    ┌───────────────────┐                        ┌─────────────────────┐
    │ Canonical         │                        │ Canonical Candle    │
    │ Order Book Engine │                        │ Aggregator          │
    │ own bookSequence  │                        │ 1s / 5s / 1m        │
    └─────────┬─────────┘                        └──────────┬──────────┘
              │                                             │
              └────────────────┬────────────────────────────┘
                               │
                    Internal Event Bus (tagged by symbol)
                               │
              ┌────────────────┴──────────────────┐
              │                                   │
              ▼                                   ▼
      ┌───────────────┐                    ┌─────────────────────┐
      │ REST API      │                    │ WebSocket Gateway   │
      │               │                    │                     │
      │ symbols       │                    │ AuthService         │
      │ snapshots     │                    │ RateLimiter         │
      │ history       │                    │ ConnectionSession   │
      │ auth ticket   │                    │ TierController      │
      │ health        │                    │ DeliveryScheduler   │
      └───────┬───────┘                    └──────────┬──────────┘
              │                                       │
              └──────────────────┬────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Next.js Trading UI     │
                    │                        │
                    │ MarketSocketClient     │
                    │ OrderBookSync (per sym)│
                    │ TanStack Query         │
                    │ Zustand                │
                    │ Lightweight Charts     │
                    └────────────────────────┘
```

### The one rule that shapes everything

> **The tiering system is never part of the market-data calculation pipeline.**

The server always processes 100% of trades and computes the full order book and full candle state.
Tiering is applied **afterwards**, when deciding how often a given client is told about the current
candle.

```text
Full client       ──────► 10 candle updates/sec
Degraded client   ──────►  2 candle updates/sec
Minimal client    ──────►  0.5 candle updates/sec

                         BUT

Canonical candle ──────► exactly identical for all three.
```

That separation is the central architectural argument of this project. See
[`07-invariants.md` I2](./07-invariants.md#i2--candle-invariance) and
[`adr/0003-tiering-outside-pipeline.md`](./adr/0003-tiering-outside-pipeline.md).

---

## 2. Repository layout

```text
crypto-terminal/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── trading/
│   │   │   ├── chart/
│   │   │   ├── orderbook/
│   │   │   └── debug/
│   │   │
│   │   ├── features/
│   │   │   └── market/
│   │   │       ├── api/
│   │   │       ├── socket/
│   │   │       ├── orderbook/
│   │   │       ├── chart/
│   │   │       └── stores/
│   │   │
│   │   └── tests/
│   │
│   └── api/
│       ├── src/
│       │   ├── app/
│       │   ├── config/
│       │   ├── market/
│       │   │   ├── simulator/
│       │   │   ├── orderbook/
│       │   │   ├── candles/
│       │   │   └── events/
│       │   ├── websocket/
│       │   │   ├── connection-session.ts
│       │   │   ├── tier-controller.ts
│       │   │   ├── delivery-scheduler.ts
│       │   │   └── heartbeat.ts
│       │   ├── routes/
│       │   └── observability/
│       └── tests/
│
├── packages/
│   └── protocol/
│       ├── src/
│       │   ├── rest.ts
│       │   ├── websocket.ts
│       │   ├── market.ts
│       │   └── schemas.ts
│       └── tests/
│
├── e2e/
├── docker/
├── .github/workflows/
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── README.md
```

**The protocol is a package of its own.** The UI does not import backend internals. Both apps import
`@repo/protocol`, which owns the Zod schemas and the TypeScript types derived from them.

---

## 3. Dependency direction

One way, always:

```text
HTTP / WS transport
        ↓
  application layer
        ↓
   market domain
```

Never:

```text
OrderBook → Fastify        ❌
CandleAggregator → React   ❌
```

Domain code does not know Fastify exists. That is what makes the market engine testable in
isolation and what lets test T3 run three virtual clients without a network.

---

## 4. Module inventory

Avoid a 1,500-line `server.ts`. These are the units:

**Domain**

| Module | Responsibility |
| --- | --- |
| `SymbolRegistry` | Owns the five `SymbolEngine`s and their static config; the only module aware that more than one symbol exists |
| `SymbolEngine` | One symbol: derived PRNG seed, generator, book, aggregators, `tradeId` counter |
| `MarketSimulator` | Seeded PRNG + event generation for one symbol |
| `OrderBook` | Canonical book state for one symbol, own `bookSequence`, snapshots, deltas |
| `CandleAggregator` | One per symbol per interval; OHLCV from canonical trades |
| `MarketEngine` | Owns the single logical clock; advances every `SymbolEngine` |
| `MarketEventBus` | Internal fan-out to transports, tagged by symbol |

**Application / transport**

| Module | Responsibility |
| --- | --- |
| `AuthService` | Mints and verifies connect tickets; tracks consumed ticket ids |
| `RateLimiter` | Per-connection token buckets by frame type ([`01-protocol.md §8`](./01-protocol.md#8-rate-limiting)) |
| `ConnectionSession` | Per-socket state, holding a `SymbolSubscription` per symbol — see [`03-adaptive-delivery.md §8`](./03-adaptive-delivery.md#8-connectionsession) |
| `TierController` | RTT/jitter → `autoTier`, with hysteresis |
| `CandleDeliveryScheduler` | Per-connection send pacing, pending finalised candles |
| `MarketRepository` | Read access to canonical state for REST |
| `RestController` | Route handlers |
| `WebSocketGateway` | Socket lifecycle, frame routing, validation |

**Frontend**

| Module | Responsibility |
| --- | --- |
| `MarketSocketClient` | Ticket fetch / connect / reconnect / ping / decode / emit — no React |
| `OrderBookSynchronizer` | Snapshot + delta merge, gap detection — **one instance per symbol** |
| `CandlestickChartAdapter` | Imperative wrapper over Lightweight Charts |
| Zustand store | Realtime app state |
| TanStack Query | REST server state |

---

## 5. Deployment topology

The browser talks to the backend directly. Next.js does **not** proxy the WebSocket.

```text
browser
 ├── https://terminal.example.com   → Vercel
 │
 ├── https://api.example.com        → backend REST
 │
 └── wss://api.example.com/v1/ws    → backend WS
```

Next.js uses the App Router. Keep it simple:

```text
app/page.tsx                  Server Component shell
        │
        ▼
<TradingTerminal />           Client Component
```

Everything touching WebSockets, the chart, or browser lifecycle lives below a `"use client"`
boundary. Do not scatter Server Components through this app to look modern — there is no server
data-fetching story here worth the complexity.

Details: [`06-ops-deploy.md`](./06-ops-deploy.md).

---

## 6. Single-instance constraint

If two replicas each generate their own synthetic market, `A != B` and clients disagree. For this
system, **one authoritative market-engine instance** is the design. The horizontal-scaling path is
documented but not built — see [`adr/0004-no-redis-nats.md`](./adr/0004-no-redis-nats.md).

---

## Open questions

- Does the event bus need backpressure of its own, or is per-connection buffering sufficient?
  *(assumed: per-connection is sufficient at this scale)*

**Resolved:** five symbols — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — each with a
fully independent engine ([`adr/0006-per-symbol-engines.md`](./adr/0006-per-symbol-engines.md)).
WebSocket connections are gated by a short-lived ticket
([`adr/0007-ws-auth-ticket.md`](./adr/0007-ws-auth-ticket.md)).
