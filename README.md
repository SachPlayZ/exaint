<!-- prettier-ignore -->
<div align="center">

# Adaptive Crypto Trading Terminal
*Deterministic synthetic markets delivered over adaptive WebSocket tiers*

[![CI](https://img.shields.io/github/actions/workflow/status/SachPlayZ/exaint/pr.yml?branch=main&style=flat-square&label=CI)](https://github.com/SachPlayZ/exaint/actions)
[![Node version](https://img.shields.io/badge/Node.js->=22.12.0-3c873a?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9%20Strict-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16%20App%20Router-black?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![Fastify](https://img.shields.io/badge/Fastify-5-black?style=flat-square&logo=fastify&logoColor=white)](https://fastify.dev)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-ef4444?style=flat-square&logo=turborepo&logoColor=white)](https://turbo.build)

[Live Deployment](#live-deployment) • [Architecture](#architecture--system-design) • [Core Invariants](#core-invariants-the-hiring-signal) • [Adaptive Protocol](#adaptive-delivery-protocol) • [Quickstart](#local-development) • [Deployment](#deployment-architecture)

</div>

---

A production-grade, real-time cryptocurrency trading terminal powered by deterministic synthetic market engines. Five independent markets — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, and `ZEC-USD` — execute canonical order books, trades, and OHLCV candles, delivering market data to clients over WebSockets at an adaptive frequency tier (Full, Degraded, Minimal) dynamically matched to each client's measured round-trip latency and jitter.

Tiering dynamically regulates **delivery cadence**, never **canonical content**.

---

## Live Deployment

The system is deployed and active in production:

| Service | Endpoint | Role |
| :--- | :--- | :--- |
| **Web Terminal** | [exaint.sachindra.codes](https://exaint.sachindra.codes) | Next.js 16 trading terminal hosted on Vercel |
| **API Gateway** | [exaint-api.sachindra.codes](https://exaint-api.sachindra.codes) | Fastify 5 REST & WebSocket gateway on Amazon EC2 |
| **WebSocket Stream** | `wss://exaint-api.sachindra.codes/v1/ws` | Authenticated real-time market data feed |
| **Health Check** | [exaint-api.sachindra.codes/healthz](https://exaint-api.sachindra.codes/healthz) | Gateway and market runtime liveness check |
| **Prometheus Metrics**| [exaint-api.sachindra.codes/metrics](https://exaint-api.sachindra.codes/metrics) | Scrape endpoint for connections, tiers, and resyncs |

> [!TIP]
> You can inspect the live market registry directly via cURL:
> ```bash
> curl -s https://exaint-api.sachindra.codes/v1/markets | jq .
> ```

---

## Architecture & System Design

The system enforces a strict one-way dependency rule:

$$\text{HTTP / WS Transport Layer} \longrightarrow \text{Application Layer} \longrightarrow \text{Market Domain Layer}$$

Domain code (`OrderBook`, `CandleAggregator`, `MarketClock`) has zero dependencies on Fastify or React. Protocol contracts are shared via `@repo/protocol` with runtime Zod validation at every network boundary.

```text
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

The system guarantees three non-negotiable correctness invariants across all operational conditions (network jitter, dropped frames, server restarts, disconnects):

### Invariant 1: Order Book Continuity (Per-Symbol)

$$\text{localBook}[symbol].\text{sequence} \equiv \text{lastSuccessfullyAppliedDelta}[symbol].\text{sequence}$$

A delta is applied **if and only if** `delta.previousSequence === localBook[delta.symbol].sequence`. If a sequence gap or mismatch is detected, the frontend transitions the symbol to `RESYNCING`, keeps the last known book visible with a status banner, buffers incoming deltas, and fetches a fresh snapshot. No guessing, no patching, no skips.

> [!IMPORTANT]
> If deltas arrive out of sequence, the client never patches or skips. It buffers incoming packets, queries `GET /v1/markets/:symbol/book`, discards stale buffered deltas, and replays contiguous deltas to guarantee zero book desynchronization.

- *Enforcement:* `apps/api/tests/market/order-book.test.ts`, `apps/web/tests/orderbook/synchronizer.test.ts`, `apps/web/e2e/recovery.spec.ts`

### Invariant 2: Candle Invariance Across Delivery Tiers

$$\text{FinalCandle}(\text{FULL}) \equiv \text{FinalCandle}(\text{DEGRADED}) \equiv \text{FinalCandle}(\text{MINIMAL})$$

Delivery tiers alter **cadence only** (active candle updates and trade batch frequency), never book deltas and never candle calculations. Exactly one canonical candle engine per symbol aggregates ticks. When a candle bucket closes, the finalized candle is guaranteed identical across all tiers.

- *Enforcement:* `apps/api/tests/websocket/candle-invariance.test.ts`, `apps/api/tests/websocket/tier-controller.test.ts`

### Invariant 3: Ordering by Identifier, Never by Timestamp

Authoritative sequence keys are monotonically increasing integers scoped strictly per symbol: `tradeId`, `bookSequence`, and `lastTradeId`. Wall-clock timestamps are strictly display data. Arrival order over the network is never assumed to be canonical order.

- *Enforcement:* `packages/protocol/tests/doc-examples.test.ts`, `apps/api/tests/market/order-book.test.ts`, `apps/web/tests/chart/candle-data.test.ts`

---

## Technology Stack

Every dependency in the monorepo has an explicit purpose and architectural justification:

| Package | Workspace | Role | Justification |
| :--- | :--- | :--- | :--- |
| `next` | `apps/web` | Framework & App Shell | Next.js 16 App Router with Turbopack for production SSR shell and static asset bundling ([ADR 0008](./docs/adr/0008-app-router.md)). |
| `react` / `react-dom` | `apps/web` | UI Rendering | React 19 concurrent features, optimized UI rendering for terminal panels. |
| `fastify` | `apps/api` | HTTP Server | High throughput, extremely low overhead, native JSON serialization, clean plugin lifecycle. |
| `@fastify/websocket` / `ws` | `apps/api` | WebSocket Transport | RFC 6455 compliant WebSocket server integrated directly into Fastify route lifecycle. |
| `@fastify/cors` | `apps/api` | CORS Security | Explicit origin restriction based on `ALLOWED_ORIGINS` environment configuration. |
| `@fastify/rate-limit` | `apps/api` | REST Protection | In-memory token bucket rate limiting on public REST routes preventing DoS attacks. |
| `zod` | `@repo/protocol` | Schema & Validation | Single source of truth for all wire schemas (`@repo/protocol`), generating static TypeScript types via `z.infer` and validating every inbound/outbound frame at runtime. |
| `@tanstack/react-query` | `apps/web` | REST Server State | Query keys, background refetching, deduplication, and declarative `AbortSignal` cancellation for symbol/interval switching. |
| `zustand` | `apps/web` | Realtime Client Store | Micro-state management for RTT, jitter, delivery tier, connection status, and UI settings without triggering full React tree re-renders. |
| `lightweight-charts` | `apps/web` | Canvas Chart Renderer | High-performance canvas candlestick chart renderer (v5.2). Pure imperative adapter; never fetches or streams its own data. |
| `tailwindcss` | `apps/web` | Utility Styling | Modern CSS styling (Tailwind v4), industrial dark palette, sub-pixel grid alignment. |
| `vitest` | Monorepo | Unit & Property Tests | Native ESM test framework sharing configuration across packages for sub-second test execution. |
| `fast-check` | Monorepo | Generative Property Tests| Fuzzing and generative property-based testing verifying order book bid/ask invariants across thousands of random runs. |
| `@playwright/test` | `apps/web` | E2E Integration Suite | Headless Chromium integration testing verifying network disconnects, book delta drops, and responsive breakpoints. |
| `turbo` | Monorepo | Monorepo Orchestration | High-speed pipeline build caching and parallel task execution across all packages. |
| `tsx` | `apps/api` | Development Runtime | Native TypeScript execution with zero-transpilation watch mode. |
| `typescript` | Monorepo | Strict Static Typing | Strict mode enabled everywhere (`strict: true`, `noUncheckedIndexedAccess: true`). Zero `any`, zero unchecked casts. |

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
- **25-Level Order Book:** Each side maintains 25 discrete price levels. Limit orders, cancellations, and aggressive market trades maintain a strict bid-ask spread ($P_{\text{bid}} < P_{\text{ask}}$).
- **Fixed-Point Precision:** Prices (scale 4, $0.0001$) and quantities (scale 8, $0.00000001$) are computed strictly as native `bigint` integers. They are serialized as decimal strings over the wire and converted to floating-point numbers **only** at the chart canvas boundary.

---

## Adaptive Delivery Protocol

Clients continuously report network health, and the server adapts data delivery rates accordingly:

| Tier | Latency RTT | Jitter | Candle Update Hz | Trade Batch Hz |
| :--- | :--- | :--- | :--- | :--- |
| **`FULL`** | $< 100\text{ ms}$ | $< 20\text{ ms}$ | $10\text{ Hz } (100\text{ ms})$ | $5\text{ Hz } (200\text{ ms})$ |
| **`DEGRADED`** | $100 - 300\text{ ms}$ | $20 - 50\text{ ms}$ | $2\text{ Hz } (500\text{ ms})$ | $2\text{ Hz } (500\text{ ms})$ |
| **`MINIMAL`** | $> 300\text{ ms}$ | $> 50\text{ ms}$ | $0.5\text{ Hz } (2000\text{ ms})$ | $0.5\text{ Hz } (2000\text{ ms})$ |

1. **Heartbeat & Latency Measurement:** The client sends `network.ping` with a high-resolution `performance.now()` timestamp every 2 seconds. The server echoes with `network.pong`, and the client computes an Exponentially Weighted Moving Average (EWMA) of RTT and jitter ($\alpha = 0.2$).
2. **Network Reports:** Every 5 seconds, the client sends `network.report` containing smoothed RTT and jitter.
3. **Hysteresis:** To prevent oscillation, the server requires **3 consecutive degraded samples** to demote a tier, and **5 consecutive good samples** to promote.
4. **Missing Reports Ladder:** If client reports stop arriving:
   - $15\text{s}$ without report $\rightarrow$ Demoted to `DEGRADED`
   - $30\text{s}$ without report $\rightarrow$ Demoted to `MINIMAL`
   - $45\text{s}$ without report $\rightarrow$ Socket closed with code `4408 (PING_TIMEOUT)`
5. **Backpressure Handling:** If WebSocket `bufferedAmount` exceeds thresholds:
   - Level 1 ($64\text{ KB}$): Coalesce intermediate candle updates.
   - Level 2 ($256\text{ KB}$): Drop non-essential trade batches.
   - Level 3 ($1\text{ MB}$): **Never drop order book deltas**. Close socket with code `4409 (SLOW_CONSUMER)` forcing clean resynchronization.

---

## Failure Recovery & Resilience

The terminal includes automated recovery against real-world network edge cases:

- **Dropped Book Delta:** When `delta.previousSequence !== localBook.sequence`, the synchronizer immediately shifts the symbol to `RESYNCING`, renders a warning banner, buffers incoming deltas, fetches a new snapshot via REST, discards stale deltas, and replays valid contiguous deltas.
- **Offline & Disconnection:** On browser `offline` event or socket closure, data on screen is preserved and overlaid with a `STALE (LAST UPDATE X.XS AGO)` banner. An exponential backoff reconnection loop (250ms base, 10s max, 25% jitter) fetches a fresh ticket and reconnects automatically.
- **Single-Use Connect Tickets:** The gateway requires `?ticket=` on WebSocket upgrade. Tickets are HMAC-SHA256 tokens valid for 60 seconds. Each ticket is strictly single-use. Crucially, tickets authorize the **handshake only**; a live connection is never terminated when its ticket's creation TTL expires ([ADR 0007](./docs/adr/0007-ws-auth-ticket.md)).
- **Rate-Limiting Protection:** Frame types are governed by per-second token buckets. Malformed or rate-limited frames return an `error` frame without killing the connection. Three consecutive rate-limit violations trigger close code `4429 (RATE_LIMITED)`.
- **Tab Visibility Recovery:** When a tab is hidden, canvas animations pause to save battery while WebSocket ingestion continues. Returning within 30 seconds triggers an immediate health ping. Tabs hidden for $>30$ seconds execute a full hard refresh.

---

## Bonus Features

- **Watchlist Reordering (Drag & Drop + Keyboard):** Users can reorder watchlist symbols using drag-and-drop or accessible keyboard controls (`Space` to grab, `Arrow Up/Down` to move, `Enter` to drop). Custom ordering is persisted in browser `localStorage` and automatically reconciles with dynamic market registry changes. Reordering never interrupts the active chart or switches symbols.
- **Production-Style Multi-Stage Deployment:** Modular Docker packaging (`Dockerfile` with Node 24 slim, unprivileged `node` user, and native health check) and automated CI/CD deploying to Amazon EC2 (Fastify + Caddy) and Vercel (Next.js).

---

## Observability & Metrics

The Fastify backend exposes Prometheus-compatible metrics at `GET /metrics` and structured JSON logs via Pino:

- `ws_connections_total`: Total lifetime WebSocket connections established.
- `ws_connections_active`: Current active WebSocket clients.
- `ws_reconnects`: Number of client reconnects detected (via `?reconnect=true`).
- `book_resyncs{symbol}`: Count of order book resync snapshots requested per symbol.
- `tier_transitions_total{from, to}`: Delivery tier promotion/demotion counters.
- `rate_limit_strikes_total`: Rate limit violations logged per client.
- **Structured Log Events:** `ws.connected`, `ws.disconnected`, `ws.reconnected`, `ws.close_resync`, `rate_limit.strike`, and `market.tick_catchup`.

---

## Local Development

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
pnpm dev:api    # Fastify backend  -> http://localhost:8080
pnpm dev:web    # Next.js frontend -> http://localhost:3000
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

The terminal is architected for independently deployed frontend and backend services:

```text
[ Browser Client ]
  │
  ├───► HTTPS: exaint.sachindra.codes (Next.js 16 on Vercel)
  │
  └───► WSS / HTTPS: exaint-api.sachindra.codes (AWS EC2)
          │
          ▼
        Caddy 2.10 Reverse Proxy (TLS Termination, HTTP/3, Zstd/Gzip)
          │
          ▼
        Fastify 5 API Container (Docker, Node 24 slim, in-memory market engine)
```

- **Backend (Amazon EC2):** Deployed as an authoritative API container through [`deploy/ec2/compose.yml`](./deploy/ec2/compose.yml). Caddy terminates HTTPS/WSS and proxies to Fastify on the private Compose network. Runtime secrets come from AWS Systems Manager Parameter Store through the EC2 instance role.
- **Frontend (Vercel):** Deployed as a Next.js application configured with `NEXT_PUBLIC_API_URL=https://exaint-api.sachindra.codes` and `NEXT_PUBLIC_WS_URL=wss://exaint-api.sachindra.codes`.
- **Continuous Integration & Delivery (GitHub Actions):**
  - `.github/workflows/pr.yml`: Executes lint, typecheck, unit tests, Playwright E2E recovery flows, and production builds on every pull request.
  - `.github/workflows/main.yml`: Uses GitHub OIDC to push an immutable API container image to AWS ECR, deploys it via AWS SSM Run Command with health-checked rollback, and deploys the Vercel frontend. EC2 exposes zero SSH ports.

For provisioning and IAM configuration details, see [`docs/06-ops-deploy.md`](./docs/06-ops-deploy.md#4-docker-and-ec2).

---

## Known Limitations & Scaling Path

- **Single Authoritative Instance:** The market engine currently runs in-process on a single backend instance ([ADR 0004](./docs/adr/0004-no-redis-nats.md)). This eliminates distributed coordination overhead, clock synchronization drift, and race conditions for the synthetic market.
- **Scaling Path (Documented in ADR 0004):**
  1. *Symbol Sharding:* Assign independent symbol engines to dedicated gateway processes (e.g. Node A runs `BTC`/`ETH`, Node B runs `SOL`/`HYPE`/`ZEC`).
  2. *Pub/Sub Fan-Out:* For $\ge 50,000$ concurrent connections, decouple the Market Engine into a standalone publisher broadcasting tick deltas to a cluster of stateless Fastify WebSocket edge workers over NATS JetStream or Redis Streams.
