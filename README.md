# Adaptive Crypto Trading Terminal

[![CI](https://github.com/SachPlayZ/exaint/actions/workflows/pr.yml/badge.svg)](https://github.com/SachPlayZ/exaint/actions/workflows/pr.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A production-grade, real-time cryptocurrency trading terminal powered by deterministic synthetic market engines. Five independent markets — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, and `ZEC-USD` — execute canonical order books, trades, and OHLCV candles, delivering market data to clients over WebSockets at an adaptive frequency tier (Full, Degraded, Minimal) dynamically matched to each client's measured round-trip latency and jitter.

Tiering dynamically regulates **delivery cadence**, never **canonical content**.

- **Repository** — [github.com/SachPlayZ/exaint](https://github.com/SachPlayZ/exaint) (public)
- **Local Dev** — `pnpm dev` (API on `:8080`, Web on `:3000`)
- **E2E Suite** — `pnpm test:e2e` (Playwright headless Chromium recovery flows)
- **Architecture Docs** — [`docs/`](./docs/) | Build Plan: [`PLAN.md`](./PLAN.md) | Invariants: [`docs/07-invariants.md`](./docs/07-invariants.md)

---

## Table of Contents

1. [Architecture & System Design](#architecture--system-design)
2. [Core Invariants (The Hiring Signal)](#core-invariants-the-hiring-signal)
3. [Technology Stack & Packages Used](#technology-stack--packages-used)
4. [Router Choice — Next.js App Router (ADR 0008)](#router-choice--nextjs-app-router-adr-0008)
5. [State Management Separation](#state-management-separation)
6. [Deterministic Market Engine](#deterministic-market-engine)
7. [Adaptive Delivery Protocol](#adaptive-delivery-protocol)
8. [Failure Recovery & Resilience](#failure-recovery--resilience)
9. [Bonus Features](#bonus-features)
10. [Observability & Metrics](#observability--metrics)
11. [Local Development & Docker](#local-development--docker)
12. [Deployment Architecture](#deployment-architecture)
13. [Known Limitations & Scaling Path](#known-limitations--scaling-path)

---

## Architecture & System Design

The system adheres to a strict one-way dependency rule:

$$\text{HTTP / WS Transport Layer} \longrightarrow \text{Application Layer} \longrightarrow \text{Market Domain Layer}$$

Domain code (`OrderBook`, `CandleAggregator`, `MarketClock`) has zero dependencies on Fastify or React. Protocol contracts are shared via `@repo/protocol` with runtime Zod validation at every network boundary.

```
                   +-------------------------------------------------------------+
                   |                     Next.js 16 Client                       |
                   |                                                             |
                   |   +-----------------------+     +-----------------------+   |
                   |   | TanStack Query (REST) |     | Lightweight Charts    |   |
                   |   | History / Snapshot    |     | Imperative Canvas     |   |
                   |   +-----------+-----------+     +-----------^-----------+   |
                   |               |                             | (updates)     |
                   |   +-----------v-----------------------------+-----------+   |
                   |   |         React-Free Domain Composition Root          |   |
                   |   |   * MarketSocketClient (EWMA RTT, Auto-Backoff)     |   |
                   |   |   * Per-Symbol OrderBookSynchronizer (9 Steps)      |   |
                   |   |   * ChartPipeline (Merge & Generation Guard)        |   |
                   |   +-----------------------+-----------------------------+   |
                   |                           | (rAF 60fps snapshot)            |
                   |               +-----------v-----------+                     |
                   |               |     Zustand Store     |                     |
                   |               | UI State & Latency    |                     |
                   |               +-----------+-----------+                     |
                   |                           |                                 |
                   |               +-----------v-----------+                     |
                   |               |  React Terminal UI    |                     |
                   |               |  Book, Tape, Headers  |                     |
                   |               +-----------------------+                     |
                   +---------------------------^---------------------------------+
                                               |
                     HTTPS (REST) / WSS (WebSocket Tickets & Streams)
                                               |
                   +---------------------------v---------------------------------+
                   |                    Fastify 5 API Gateway                    |
                   |                                                             |
                   |   +-----------------------+     +-----------------------+   |
                   |   |   REST Controller     |     |   WebSocket Gateway   |   |
                   |   | /v1/markets           |     | /v1/ws?ticket=...     |   |
                   |   | /v1/markets/:s/book   |     | HMAC Authentication   |   |
                   |   | /v1/markets/:s/candles|     | Token-Bucket Limiter  |   |
                   |   | /v1/auth/ticket       |     | Tier & Delivery Sched |   |
                   |   +-----------+-----------+     +-----------+-----------+   |
                   |               |                             |               |
                   |   +-----------v-----------------------------v-----------+   |
                   |   |                     Market Runtime                  |   |
                   |   |   * One 50ms Logical Market Clock (Catch-up Loop)   |   |
                   |   |   * 5 Independent Symbol Engines (PRNG + Seed)      |   |
                   |   |   * 25-Level Order Book with Replenishment          |   |
                   |   |   * Canonical Candle Aggregators (1s, 5s, 1m)       |   |
                   |   +-----------------------------------------------------+   |
                   +-------------------------------------------------------------+
```

---

## Core Invariants (The Hiring Signal)

The system guarantees three non-negotiable correctness invariants across all conditions (network jitter, dropped frames, server restarts, disconnects):

### Invariant 1: Order Book Continuity (Per-Symbol)

$$\text{localBook}[symbol].\text{sequence} \equiv \text{lastSuccessfullyAppliedDelta}[symbol].\text{sequence}$$

A delta is applied **if and only if** `delta.previousSequence === localBook[delta.symbol].sequence`. If a sequence gap or mismatch is detected, the frontend transitions the symbol to `RESYNCING`, keeps the last known book visible with a status banner, buffers incoming deltas, and fetches a fresh snapshot. No guessing, no patching, no skips.
- *Tests:* `apps/api/tests/orderbook/orderbook.test.ts`, `apps/web/features/market/book/order-book-synchronizer.test.ts`, `apps/web/e2e/recovery.spec.ts`

### Invariant 2: Candle Invariance Across Delivery Tiers

$$\text{FinalCandle}(\text{FULL}) \equiv \text{FinalCandle}(\text{DEGRADED}) \equiv \text{FinalCandle}(\text{MINIMAL})$$

Delivery tiers alter **cadence only** (active candle updates and trade batch frequency), never book deltas and never candle calculations. Exactly one canonical candle engine per symbol aggregates ticks. When a candle bucket closes, the finalized candle is guaranteed identical across all tiers.
- *Tests:* `apps/api/tests/market/candle-invariance.test.ts`, `apps/api/tests/websocket/tier-controller.test.ts`

### Invariant 3: Ordering by Identifier, Never by Timestamp

Authoritative sequence keys are monotonically increasing integers scoped strictly per symbol: `tradeId`, `bookSequence`, and `lastTradeId`. Wall-clock timestamps are strictly display data. Arrival order over the network is never assumed to be canonical order.
- *Tests:* `packages/protocol/src/codecs.test.ts`, `apps/api/tests/market/orderbook.test.ts`, `apps/web/features/market/chart/market-chart-pipeline.test.ts`

---

## Technology Stack & Packages Used

Every dependency in the monorepo has an explicit purpose and architectural justification:

| Package | Workspace | Role | Justification |
| :--- | :--- | :--- | :--- |
| `next` | `apps/web` | Framework & App Shell | Next.js 16 App Router with Turbopack for production SSR shell and static asset bundling ([ADR 0008](./docs/adr/0008-app-router.md)). |
| `react` / `react-dom` | `apps/web` | UI Rendering | React 19 concurrent features, optimized UI rendering for terminal panels. |
| `fastify` | `apps/api` | HTTP Server | High throughput, extremely low overhead, native JSON serialization, clean plugin lifecycle. |
| `@fastify/websocket` / `ws` | `apps/api` | WebSocket Transport | RFC 6455 compliant WebSocket server integrated directly into Fastify route lifecycle. |
| `@fastify/cors` | `apps/api` | CORS Security | Explicit origin restriction based on `ALLOWED_ORIGINS` environment configuration. |
| `@fastify/rate-limit` | `apps/api` | REST Endpoint Protection | In-memory token bucket rate limiting on public REST routes preventing DoS attacks. |
| `zod` | `@repo/protocol` | Schema & Validation | Single source of truth for all wire schemas (`@repo/protocol`), generating static TypeScript types via `z.infer` and validating every inbound/outbound frame at runtime. |
| `@tanstack/react-query` | `apps/web` | REST Server State | Query keys, background refetching, deduplication, and declarative `AbortSignal` cancellation for symbol/interval switching. |
| `zustand` | `apps/web` | Realtime Client Store | Micro-state management for RTT, jitter, delivery tier, connection status, and UI settings without triggering full React tree re-renders. |
| `lightweight-charts` | `apps/web` | Canvas Chart Renderer | High-performance canvas candlestick chart renderer (v5.2). Pure imperative adapter; never fetches or streams its own data. |
| `tailwindcss` | `apps/web` | Utility Styling | Modern CSS styling (Tailwind v4), industrial dark palette, sub-pixel grid alignment. |
| `vitest` | Monorepo | Unit & Property Test Runner | Native ESM test framework sharing configuration across packages for sub-second test execution. |
| `fast-check` | Monorepo | Generative Property Tests | Fuzzing and generative property-based testing verifying order book bid/ask invariants across thousands of random runs. |
| `@playwright/test` | `apps/web` | E2E Integration Suite | Headless Chromium integration testing verifying network disconnects, book delta drops, and responsive breakpoints. |
| `turbo` | Monorepo | Monorepo Orchestration | High-speed pipeline build caching and parallel task execution across all packages. |
| `tsx` | `apps/api` | Development Runtime | Native TypeScript execution with zero-transpilation watch mode. |
| `typescript` | Monorepo | Strict Static Typing | Strict mode enabled everywhere (`strict: true`, `noUncheckedIndexedAccess: true`). Zero `any`, zero unchecked casts. |

---

## Router Choice — Next.js App Router (ADR 0008)

The frontend is built on **Next.js App Router** (`apps/web/app/`), following the architectural decision documented in [`docs/adr/0008-app-router.md`](./docs/adr/0008-app-router.md):

1. **Thin Server Shell:** The root layout and page define HTML structure, SEO metadata, fonts, and dark theme tokens on the server.
2. **One `"use client"` Boundary:** The entire dynamic trading terminal sits under a single client boundary (`TerminalContainer`).
3. **Why Server Components are NOT used for market data:** Server Components stream via HTTP chunked encoding, which is fundamentally incompatible with high-frequency WebSocket bidirectional streams, sub-50ms order book deltas, and imperative WebGL/canvas rendering. The client establishes a direct WebSocket connection to the API gateway (`wss://api.../v1/ws`) without proxying through Next.js.

---

## State Management Separation

To maintain 60 FPS under continuous market updates, state is strictly segregated into three tiers:

```text
[ Incoming WebSocket Frame / REST Response ]
                     │
                     ▼
       React-Free In-Memory Domain
  (OrderBookSynchronizer, ChartPipeline)
  Mutates immediately on every packet
  Buffer ring, delta queues, sequence checks
                     │
                     ├───► Lightweight Charts Canvas (Direct series.update())
                     │
                     ▼ (throttled to 60fps via requestAnimationFrame)
       Zustand Realtime Store
  Publishes frozen snapshot to React
                     │
                     ▼
       React Component Tree
  Header, OrderBookPanel, RecentTrades
```

- **REST Server State (`@tanstack/react-query`):** Manages market registry, initial snapshots, and candle history. Every query receives an `AbortSignal` tied to the active symbol/interval generation ID, guaranteeing late responses cannot clobber active state.
- **High-Frequency Realtime State (Domain Models):** Order book deltas and trade packets mutate in-memory structures immediately without triggering React renders. An animation frame scheduler publishes immutable UI snapshots at most once every 16.6ms.
- **Canvas Chart Rendering (`lightweight-charts`):** The chart adapter owns the canvas instance directly. Historical data loads via `setData()`, and streaming live candles apply via `update()`. React never diffs chart elements.

---

## Deterministic Market Engine

The backend generates synthetic market activity across five distinct assets with realistic liquidity profiles:

- **Seeded PRNG:** Uses SplitMix64 initialized with `MARKET_SEED` (default `1337`). Each symbol engine derives an independent deterministic sub-seed (`seed ^ symbolHash`), ensuring zero cross-symbol coupling ([ADR 0006](./docs/adr/0006-per-symbol-engines.md)).
- **Logical Market Clock:** A central logical clock ticks every 50ms. If the event loop stalls, the scheduler calculates owed ticks and executes them sequentially in catch-up mode up to `MARKET_MAX_CATCHUP_TICKS`. Wall-clock time never governs market state.
- **25-Level Order Book:** Each side maintains 25 discrete price levels. Limit orders, cancellations, and aggressive market trades maintain a strict bid-ask spread ($P_{bid} < P_{ask}$).
- **Fixed-Point Precision:** Prices (scale 4, $0.0001$) and quantities (scale 8, $0.00000001$) are computed strictly as native `bigint` integers. They are serialized as decimal strings over the wire and converted to floating-point numbers **only** at the chart canvas boundary.

---

## Adaptive Delivery Protocol

Clients continuously report network health, and the server adapts data delivery rates accordingly:

```text
+-------------------------------------------------------------------------+
| Tier      | Latency RTT   | Jitter   | Candle Update Hz | Trade Batch Hz |
+-----------+---------------+----------+------------------+----------------+
| FULL      | < 100 ms      | < 20 ms  | 10 Hz (100 ms)   | 5 Hz (200 ms)  |
| DEGRADED  | 100 - 300 ms  | 20-50 ms | 2 Hz (500 ms)    | 2 Hz (500 ms)  |
| MINIMAL   | > 300 ms      | > 50 ms  | 0.5 Hz (2000 ms) | 0.5 Hz (2000 ms|
+-------------------------------------------------------------------------+
```

1. **Heartbeat & Latency Measurement:** The client sends `network.ping` with a high-resolution `performance.now()` timestamp every 2 seconds. The server echoes with `network.pong`, and the client computes an Exponentially Weighted Moving Average (EWMA) of RTT and jitter ($\alpha = 0.2$).
2. **Network Reports:** Every 5 seconds, the client sends `network.report` containing smoothed RTT and jitter.
3. **Hysteresis:** To prevent oscillation, the server requires **3 consecutive degraded samples** to demote a tier, and **5 consecutive good samples** to promote.
4. **Missing Reports Ladder:** If client reports stop arriving:
   - 15s without report $\rightarrow$ Demoted to `DEGRADED`
   - 30s without report $\rightarrow$ Demoted to `MINIMAL`
   - 45s without report $\rightarrow$ Socket closed with code `4408 (PING_TIMEOUT)`
5. **Backpressure Handling:** If WebSocket `bufferedAmount` exceeds thresholds:
   - Level 1 ($64\text{ KB}$): Coalesce intermediate candle updates.
   - Level 2 ($256\text{ KB}$): Drop non-essential trade batches.
   - Level 3 ($1\text{ MB}$): **Never drop order book deltas**. Close socket with code `4409 (SLOW_CONSUMER)` forcing clean resynchronization.

---

## Failure Recovery & Resilience

The terminal includes defense and automated recovery against all real-world edge cases:

- **Dropped Book Delta:** When `delta.previousSequence !== localBook.sequence`, the synchronizer immediately shifts the symbol to `RESYNCING`, renders a warning banner, buffers incoming deltas, fetches a new snapshot via REST, discards stale deltas, and replays valid contiguous deltas.
- **Offline & Disconnection:** On browser `offline` event or socket closure, data on screen is preserved and overlaid with a `STALE (LAST UPDATE X.XS AGO)` banner. An exponential backoff reconnection loop (250ms base, 10s max, 25% jitter) fetches a fresh ticket and reconnects automatically.
- **Single-Use Connect Tickets:** The gateway requires `?ticket=` on WebSocket upgrade. Tickets are HMAC-SHA256 tokens valid for 60 seconds. Each ticket is strictly single-use. Crucially, tickets authorize the **handshake only**; a live connection is never terminated when its ticket's creation TTL expires ([ADR 0007](./docs/adr/0007-ws-auth-ticket.md)).
- **Rate-Limiting Protection:** Frame types are governed by per-second token buckets. Malformed or rate-limited frames return an `error` frame without killing the connection. Three consecutive rate-limit violations trigger close code `4429 (RATE_LIMITED)`.
- **Tab Visibility Recovery:** When a tab is hidden, canvas animations pause to save battery while WebSocket ingestion continues. Returning within 30 seconds triggers an immediate health ping. Tabs hidden for $>30$ seconds execute a full hard refresh.

---

## Bonus Features

- **Watchlist Reordering (Drag & Drop + Keyboard):** Users can reorder watchlist symbols using intuitive drag-and-drop or accessible keyboard controls (`Space` to grab, `Arrow Up/Down` to move, `Enter` to drop). Custom ordering is persisted in browser `localStorage` and automatically reconciles with dynamic market registry changes. Reordering never interrupts the active chart or switches symbols.
- **Production-Style Multi-Stage Deployment:** Modular Docker packaging (`Dockerfile` with Node 24 slim, unprivileged `node` user, and curl-free native health check) and automated CI/CD pipelines deploying frontend and backend independently with production secrets.

---

## Observability & Metrics

The Fastify backend exposes Prometheus-compatible metrics at `GET /metrics` and structured JSON logs via Pino:

- `ws_connections_total`: Total lifetime WebSocket connections established.
- `ws_connections_active`: Current active WebSocket clients.
- `ws_reconnects`: Number of client reconnects detected (via `?reconnect=true`).
- `book_resyncs{symbol}`: Count of order book resync snapshots requested per symbol.
- `tier_transitions_total{from, to}`: Delivery tier promotion/demotion counters.
- `rate_limit_strikes_total`: Rate limit violations logged per client.
- Structured Log Events: `ws.connected`, `ws.disconnected`, `ws.reconnected`, `ws.close_resync`, `rate_limit.strike`, and `market.tick_catchup`.

---

## Local Development & Docker

### Prerequisites
- Node.js $\ge 22.12.0$
- pnpm $\ge 10.12.0$

### Quickstart

```bash
# 1. Install dependencies across all monorepo packages
pnpm install

# 2. Run both API (:8080) and Web (:3000) concurrently
pnpm dev

# Or run services individually:
pnpm dev:api    # Fastify backend
pnpm dev:web    # Next.js frontend
```

### Verification & Testing Suite

```bash
# Run ESLint & Prettier
pnpm lint

# Strict TypeScript type check across monorepo
pnpm typecheck

# Run 335+ unit and property tests (Vitest + fast-check)
pnpm test

# Run Playwright E2E recovery flows (Chromium)
pnpm test:e2e

# Production build
pnpm build
```

### Docker Compose

Run the complete multi-service production stack locally:

```bash
docker compose up --build
```
- API Gateway: `http://localhost:8080` (Health: `http://localhost:8080/healthz`)
- Web Terminal: `http://localhost:3000`

---

## Deployment Architecture

The terminal is architected for independent, zero-downtime deployment:

- **Backend (Fly.io):** Deployed as a single container running the Fastify WebSocket gateway on port 8080 (`fly.toml`). Authenticates connections via `AUTH_TICKET_SECRET` with CORS locked to the frontend domain.
- **Frontend (Vercel):** Deployed as a static/edge-rendered Next.js application connecting to the backend via `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`.
- **Continuous Integration (GitHub Actions):**
  - `.github/workflows/pr.yml`: Executes lint, typecheck, unit tests, Playwright E2E recovery flows, and production builds on every pull request.
  - `.github/workflows/main.yml`: Full deployment pipeline triggering Docker container verification and deployment gates upon merge to `main`.

---

## Known Limitations & Scaling Path

- **Single Authoritative Instance:** The market engine currently runs in-process on a single backend instance ([ADR 0004](./docs/adr/0004-no-redis-nats.md)). This eliminates distributed coordination overhead, clock synchronization drift, and race conditions for the synthetic market.
- **Scaling Path (Documented in ADR 0004):**
  1. *Symbol Sharding:* Assign independent symbol engines to dedicated gateway processes (e.g. Node A runs `BTC`/`ETH`, Node B runs `SOL`/`HYPE`/`ZEC`).
  2. *Pub/Sub Fan-Out:* For $\ge 50,000$ concurrent connections, decouple the Market Engine into a standalone publisher broadcasting tick deltas to a cluster of stateless Fastify WebSocket edge workers over NATS JetStream or Redis Streams.

---

## License

MIT © [SachPlayZ](https://github.com/SachPlayZ)
