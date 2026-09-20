# PLAN.md — Adaptive Crypto Trading Terminal

> Build plan of record. Rules of engagement: [`AGENTS.md`](./AGENTS.md).
> Live progress: [`tasks/todo.md`](./tasks/todo.md).

---

## Objective

Ship a small **production trading system** — not "Next.js + a WebSocket + some random numbers".
Five live markets (`BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD`), one canonical engine
each, per-client adaptive delivery over an authenticated, rate-limited WebSocket.
The deliverable is judged on defensible invariants, not on how pretty the chart is.

### Success criteria

1. **I1** — each symbol's order book stays continuous by sequence; every gap triggers a clean
   resync of that symbol alone. ([`docs/07-invariants.md`](./docs/07-invariants.md))
2. **I2** — final OHLCV candles are byte-identical across Full / Degraded / Minimal tiers,
   proven by a test over 10,000 deterministic trades, per symbol.
3. **I3** — all ordering derives from `tradeId` / `bookSequence`, never from timestamps, and never
   across symbols.
4. Recovery is demonstrable live: drop a delta → `RESYNCING` → recovered; go offline →
   `STALE` → `RECONNECTING` → `LIVE`, with the UI never blanking.
5. Switching symbols is instant and never merges a late response into the wrong market.
6. The screen is genuinely responsive, and ≥10 bids and ≥10 asks stay visible at every width.
7. A 90–120s screen recording tells the whole technical story (§ Demo script).
8. README explains the architecture well enough that a reviewer needs no walkthrough, including
   packages used and the router choice.
9. Bonus claimed: watchlist reordering, plus separate-service deployment with automated builds.

---

## Effort budget

Deliberate allocation. The unusual part of this assignment is correctness, so that is where the
hours go. Do not invert this.

```text
30%  Backend / data correctness
20%  Synchronisation / recovery
15%  Adaptive delivery
15%  Frontend architecture + performance
10%  UI polish
10%  Tests / README / deployment
```

The UI must still look excellent. It just must not eat the budget.

---

## Stack (fixed — see ADRs before changing anything here)

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 16.3.x (Active LTS) + TypeScript, App Router |
| Styling | Tailwind + shadcn/ui |
| REST server state | TanStack Query |
| Realtime UI state | Zustand |
| Runtime protocol validation | Zod |
| Chart | TradingView Lightweight Charts 5.2 |
| Backend | Node.js 24 LTS + TypeScript + Fastify |
| WebSocket | `@fastify/websocket` / `ws` |
| Unit tests | Vitest |
| Property tests | fast-check |
| E2E | Playwright |
| Frontend deploy | Vercel |
| Backend deploy | Fly.io (Render / Railway equivalent) — persistent container |
| CI | GitHub Actions |

As of 2026-09-20: Next.js 16.3.3 is the Active LTS security-patched branch; Node 24 is an LTS
branch; Lightweight Charts current docs are 5.2.

TypeScript end-to-end rather than Go — see
[`docs/adr/0001-typescript-over-go.md`](./docs/adr/0001-typescript-over-go.md).

---

## Phase dependency graph

```text
P0 scaffold
   │
   ▼
P1 protocol contracts ──────────────┐
   │                                │
   ▼                                │
P2 deterministic market domain      │
   │                                │
   ▼                                │
P3 candle engine                    │
   │                                │
   ├────────────┐                   │
   ▼            ▼                   │
P4 REST      P5 WebSocket           │
                │                   │
                ▼                   │
        P6 adaptive delivery        │
                │                   │
                ▼                   ▼
        P7 frontend networking ◄────┘
                │
                ▼
        P8 order-book synchroniser
                │
                ▼
        P9 chart
                │
                ▼
        P10 UI + debug panel
                │
                ▼
        P11 failure handling
                │
                ▼
        P12 Playwright + deploy + README + recording
```

Build in this order because it minimises rework: contracts before producers, producers before
transport, transport before UI, correctness before polish.

---

## Phases

Every phase carries `Goal` · `Deliverables` · `Docs to read` · `Definition of Done`.
The global gate in [`AGENTS.md` §6](./AGENTS.md#6-definition-of-done-phase-gate) applies to all of
them in addition to what is listed here.

---

### P0 — Scaffold

**Goal.** A monorepo that installs, lints, typechecks, and builds with nothing in it.

**Deliverables.**
- `pnpm-workspace.yaml`, `turbo.json`, root `package.json` with the scripts from
  [`AGENTS.md` §7](./AGENTS.md#7-commands).
- `apps/web` (Next.js 16.3.x, App Router, TS strict), `apps/api` (Fastify + TS),
  `packages/protocol` (empty, buildable).
- Shared `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`.
- ESLint + Prettier, Vitest config, `.env.example` files.
- GitHub Actions PR workflow skeleton (install → lint → typecheck → test → build).

**Docs.** [`00-architecture.md`](./docs/00-architecture.md), [`06-ops-deploy.md`](./docs/06-ops-deploy.md)

**DoD.** `pnpm install && pnpm lint && pnpm typecheck && pnpm build` all pass on a clean clone.

---

### P1 — Protocol contracts

**Goal.** Both apps agree on every byte before either produces one.

**Deliverables.** In `packages/protocol/src/`:
- `market.ts` — `Symbol`, `Trade`, `BookSnapshot`, `BookDelta`, `Candle`, `Interval`, `Tier`,
  `NetworkReport`, `Channel`
- `rest.ts` — request params + response shapes for symbols / snapshot / history / health / ticket
- `websocket.ts` — every client and server frame, discriminated on `type`
- `auth.ts` — ticket payload, error codes, close codes
- `schemas.ts` — the Zod schemas; TS types derived via `z.infer`, never hand-written twice
- Decimal-string ↔ `bigint` codecs with their own tests

**Docs.** [`01-protocol.md`](./docs/01-protocol.md)

**DoD.** Round-trip test: every example message in `01-protocol.md` parses; every malformed variant
is rejected with the documented error code. `@repo/protocol` imports cleanly from both apps.

---

### P2 — Deterministic market domain

**Goal.** A market that replays identically from a seed.

**Deliverables.** `apps/api/src/market/`:
- `simulator/prng.ts` — PCG or xorshift; per-symbol seed derived from `MARKET_SEED` (default `1337`)
- `simulator/clock.ts` — one logical tick of `50ms` driving all engines; wall clock only asks how
  many ticks are owed
- `simulator/generator.ts` — three event kinds: new limit order, cancel/update, market trade
- `symbol-registry.ts` — five `SymbolEngine`s with per-symbol tick size, base price, size
  distribution, volatility
- `orderbook/` — 25 levels per side, depletion + replenishment away from mid, monotonic per-symbol
  `bookSequence`, snapshot + delta emission
- `fixed-point.ts` — price scale `4`, quantity scale `8`, all `bigint`, uniform across symbols

**Docs.** [`02-market-domain.md`](./docs/02-market-domain.md),
[`adr/0006`](./docs/adr/0006-per-symbol-engines.md)

**DoD.** Same seed + same start time ⇒ byte-identical event stream across two runs, for all five
symbols (test). Buy trades consume asks, sell trades consume bids (test). Bid < ask always holds
(property test). `bookSequence` strictly increases by 1 per symbol, with no shared counters (test).
Five symbols visibly differ in price level, spread, and volatility.

---

### P3 — Candle engine

**Goal.** One canonical aggregator per interval. No tier awareness anywhere in it.

**Deliverables.**
- `candles/aggregator.ts` — intervals `1s`, `5s`, `1m` per symbol (15 aggregators); every canonical
  trade fans out to its own symbol's three
- Candle shape: `startTime, open, high, low, close, volume, tradeCount, lastTradeId`
- Boundary: `floor(trade.timestamp / intervalMs) * intervalMs`
- Ring-buffer history store per interval, sized for `limit=300` plus headroom
- Finalisation events when a bucket closes

**Docs.** [`02-market-domain.md`](./docs/02-market-domain.md#8-candle-engine)

**DoD.** OHLCV correctness tests incl. single-trade candles, boundary trades, empty intervals.
Volume summed in `bigint` with zero precision loss (property test). No float anywhere in the path.

---

### P4 — REST API

**Goal.** Bootstrapping without the WebSocket.

**Deliverables.**
- `GET /v1/markets` — symbol registry with `priceScale`, `quantityScale`, `tickSize`, `bookDepth`
- `GET /v1/markets/:symbol/book` — snapshot with that symbol's `sequence`
- `GET /v1/markets/:symbol/candles?interval=&limit=` — ascending, unique by `startTime`,
  completed history **plus** the canonical current candle marked `"final": false`
- `POST /v1/auth/ticket` — HMAC-signed, `60s`, single-use
- `GET /healthz`, `GET /readyz`, `GET /metrics`
- CORS restricted to `ALLOWED_ORIGINS`; per-IP REST rate limits

**Docs.** [`01-protocol.md`](./docs/01-protocol.md#4-rest), [`06-ops-deploy.md`](./docs/06-ops-deploy.md)

**DoD.** Responses validate against the protocol schemas. History has no duplicate `startTime`.
`limit` is clamped and documented. `/readyz` waits for every engine's first tick. Unknown symbol →
`UNKNOWN_SYMBOL`.

---

### P5 — WebSocket gateway

**Goal.** Per-connection sessions with correct subscription semantics — still no tiering.

**Deliverables.**
- `/v1/ws?ticket=` endpoint, versioned path
- `AuthService` — mint, verify, single-use tracking; close codes `4401` / `4408`
- `RateLimiter` — per-frame-type and global token buckets, 3 strikes → close `4429`
- `ConnectionSession` per socket holding a `SymbolSubscription` per symbol (full field list in
  [`03-adaptive-delivery.md`](./docs/03-adaptive-delivery.md#8-connectionsession))
- Client frames: `subscribe` (with `channels`), `unsubscribe`, `set_interval`, `ping`,
  `network.report`, `debug.tier_override`
- Server frames: `hello`, `subscribed`, `pong`, `trades.batch`, `book.delta`, `candles.update`,
  `tier.changed`, `error`
- Zod validation on every inbound frame; malformed → `{"type":"error","code":"INVALID_MESSAGE"}`,
  connection survives
- Heartbeat

**Docs.** [`01-protocol.md`](./docs/01-protocol.md#5-websocket), [`03-adaptive-delivery.md`](./docs/03-adaptive-delivery.md),
[`adr/0007`](./docs/adr/0007-ws-auth-ticket.md)

**DoD.** T7 passes. Fuzzed garbage input never crashes a handler and never kills the process.
Two connections can hold different symbols and different intervals simultaneously. A connection
survives past its ticket's `exp`.

---

### P6 — Adaptive delivery

**Goal.** The headline feature. Per-connection frequency, zero effect on content.

**Deliverables.**
- `tier-controller.ts` — EWMA (`α = 0.2`) over RTT and jitter, hysteresis thresholds exactly as
  specified, initial tier `DEGRADED`, missing-report ladder `15s / 30s / 45s`
- `delivery-scheduler.ts` — candle targets `10Hz` / `2Hz` / `0.5Hz` and trade-batch targets
  `5Hz` / `2Hz` / `0.5Hz`, kept **per symbol subscription**; maintains `pendingFinalCandles` and
  `latestActiveCandle`; a send emits every pending finalised candle **plus** the newest active one
- `debug.tier_override` changes `effectiveTier` only; `autoTier` keeps being computed
- Backpressure policy on `bufferedAmount`: coalesce candles, drop stale trade batches,
  **never** drop book deltas — close the socket instead

**Docs.** [`03-adaptive-delivery.md`](./docs/03-adaptive-delivery.md)

**DoD.** Tier hysteresis test (T1) and candle-invariance test (T3) from
[`05-testing.md`](./docs/05-testing.md) both pass. Three concurrent connections hold three different
tiers — and again on three different symbols. A Minimal client never loses a finalised candle.
Both cadences visibly change with tier in the debug drawer.

---

### P7 — Frontend networking

**Goal.** Socket logic that is testable without React.

**Deliverables.**
- `MarketSocketClient` class: ticket fetch, connect, disconnect, subscribe/unsubscribe, reconnect,
  ping/pong, Zod decoding, visibility handling, typed event emitter
- Ticket fetched fresh per attempt, **inside** the backoff; never cached, never in `localStorage`
- Exponential backoff with jitter: `250ms → 500ms → 1s → 2s → 4s → 8s → max 10s`; retry count
  resets after a stable connection
- App-level ping every `2s` measured with `performance.now()`; `network.report` every `5s`
- Connection state machine: `CONNECTING / SYNCING / LIVE / STALE / RECONNECTING / ERROR`
- Zustand store for realtime state; TanStack Query for REST

**Docs.** [`04-frontend.md`](./docs/04-frontend.md)

**DoD.** Socket client unit-tested against a mock server with no React in the test.
Reconnect sequence follows the 9 documented steps, reapplying subscription, interval, and explicit
override. Close codes `4401` / `4408` / `4429` each produce the documented reaction.

---

### P8 — Order-book synchroniser

**Goal.** I1, client side. Build this **before** the pretty table.

**Deliverables.**
- Buffer-then-snapshot algorithm (9 steps, [`04-frontend.md`](./docs/04-frontend.md#5-order-book-synchronisation))
- **One synchroniser instance per symbol**, each with its own buffer, sequence, and status
- Gap detection → `RESYNCING` for that symbol only; previous book stays visible and marked
- `bookStatus`: `IDLE / SYNCING / SYNCHRONIZED / RESYNCING`

**Docs.** [`04-frontend.md`](./docs/04-frontend.md#5-order-book-synchronisation), [`07-invariants.md`](./docs/07-invariants.md)

**DoD.** Test T2 passes. Property test T4 (fast-check) passes: any valid contiguous delta chain
reproduces the authoritative book; any gap forces resync. A gap in one symbol leaves the others
`SYNCHRONIZED`.

---

### P9 — Chart

**Goal.** Lightweight Charts used purely as a renderer.

**Deliverables.**
- `CandlestickChartAdapter` wrapping the library; `setData()` for history and switches, `update()`
  for the active candle; explicit dispose on unmount and on every switch
- Symbol switching: subscribe-before-unsubscribe, per-symbol sync, price formatting from the
  registry's `tickSize`
- Interval switching with query key + `AbortSignal` + `response.interval` validation +
  generation id; WS frames for a non-selected symbol **or** interval are ignored
- History/realtime merge: buffer live candles during fetch, dedupe by
  `symbol + interval + candleStart`, resolve conflicts by higher `lastTradeId`
- Crosshair, hover OHLCV readout, pan, zoom

**Docs.** [`04-frontend.md §6`](./docs/04-frontend.md#6-symbol-switching), [`§7`](./docs/04-frontend.md#7-interval-switching), [`§9`](./docs/04-frontend.md#9-chart-adapter)

**DoD.** Tests T5 and T6 pass. No chart update path goes through React state. Switching symbols
leaves exactly one subscription behind.

---

### P10 — UI and debug panel

**Goal.** The screen a reviewer sees.

**Deliverables.**
- Desktop layout: header (watchlist, price, change, status, RTT, tier) · chart · order book ·
  network/debug · recent trades
- **Watchlist** (bonus): symbols from `GET /v1/markets`, drag **and keyboard** reordering, order
  persisted in `localStorage` behind try/catch with registry order as fallback; reordering never
  switches symbol
- **Responsive**: three breakpoints (≥1280 / ≥768 / <768), no horizontal page scroll, chart refit
  via debounced `ResizeObserver`, chart gestures do not fight page scroll
- Order book with cumulative depth bars, **at least top 10 bids and top 10 asks visible at every
  breakpoint**; buy/sell distinguished by more than colour alone
- Recent trades, newest first, capped at `50`
- Empty states: zero candles, zero trades, and an empty book each render cleanly — never an error
- Debug drawer, collapsed by default: connection id, symbol, last book sequence, last trade id,
  RTT, jitter, `autoTier`, `override`, `effectiveTier`, candle + trade target vs actual Hz, and
  `[Auto] [Full] [Degraded] [Minimal]` controls

**Docs.** [`04-frontend.md`](./docs/04-frontend.md#13-screen-layout)

**DoD.** Sustained live session holds a steady frame rate; React does not re-render per packet.
Debug drawer shows automatic and effective tier diverging under an override. Ten levels per side
visible at 1280px, 768px and 375px with no horizontal scroll. Watchlist order survives a reload and
a cleared `localStorage`.

---

### P11 — Failure handling

**Goal.** Break it on purpose, then prove it recovers.

**Deliverables + explicit tests for each.**
- network failure · missing book delta · invalid JSON frame · late history response · late snapshot
  after a symbol switch · **empty history** · duplicate candle · expired ticket on reconnect ·
  rate-limit strike close · hidden tab (under and over `30s`) · backend restart
- **Resource teardown audit** against the table in
  [`04-frontend.md §14`](./docs/04-frontend.md#14-resource-teardown): open, switch symbols
  repeatedly, background, disconnect, unmount → assert zero live timers, zero listeners, one socket
- Hidden tab: socket stays alive, repaints stop, immediate ping on wake, hard refresh of snapshot
  and history for the selected symbol after a hide longer than `30s`
- Disconnect UX: nothing blanks; everything is marked `STALE` with
  `Reconnecting… Last live update 4.2s ago`

**Docs.** [`04-frontend.md §11`](./docs/04-frontend.md#11-disconnect-and-reconnect), [`§12`](./docs/04-frontend.md#12-browser-visibility), [`§14`](./docs/04-frontend.md#14-resource-teardown), [`05-testing.md`](./docs/05-testing.md)

**DoD.** Every listed failure has a passing automated test. Teardown audit shows no leaks after 50
symbol switches.

---

### P12 — E2E, deploy, README, recording

**Goal.** Make it reviewable.

**Deliverables.**
- Playwright recovery suite: block selected WS messages, emulate offline, assert the
  `LIVE → RESYNCING → LIVE` and `LIVE → STALE → RECONNECTING → LIVE` paths
- Multi-stage Dockerfile: Node 24 LTS, non-root user, healthcheck, production deps only
- Backend on Fly.io, frontend on Vercel, HTTPS + WSS, `AUTH_MODE=ticket` with a real
  `AUTH_TICKET_SECRET` from the platform secret store
- Structured logs + metrics counters ([`06-ops-deploy.md`](./docs/06-ops-deploy.md#5-observability))
- README filled out, diagrams inline, including **Packages used** (every dependency justified),
  **Router choice**, **Bonus features**, and **Known limitations**
- Repo `github.com/SachPlayZ/exaint` made public, with a clean history and no secrets committed
- Main-branch CI: test → build web → build Docker → deploy both
- 90–120s screen recording per the script below

**Docs.** [`05-testing.md`](./docs/05-testing.md), [`06-ops-deploy.md`](./docs/06-ops-deploy.md)

**DoD.** Green CI on `main`. Both deployments reachable. Recording uploaded and linked from README.
Repo is public and a stranger can clone → `pnpm install` → `pnpm dev` with no private access.

---

## Demo script (final gate)

Record correctness, not chrome. Target 90–120 seconds.

```text
 1. Open terminal            → LIVE / Full / latency visible
 2. Chart updating           → hover a candle, show OHLCV
 3. Switch 1s → 5s → 1m      → history changes correctly
 4. Reorder watchlist, switch BTC → HYPE → SOL → five different markets
 5. Live order book          → bids/asks updating, depth bars
 6. Open debug drawer
 7. Force FULL               → ~10 Hz candles / ~5 Hz trades
 8. Force DEGRADED           → ~2 Hz / ~2 Hz
 9. Force MINIMAL            → ~0.5 Hz / ~0.5 Hz
10. Return to Auto
11. Kill network / backend   → STALE, data still on screen
12. Restore                  → RECONNECTING → SYNCING → LIVE
13. Tests passing
```

Between steps 7–9, say the line out loud: the numbers on screen change frequency, the candle
values do not. At step 4, point out that each symbol has its own sequence and its own resync.

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Event-loop stall shifts the market sequence | Breaks determinism, breaks tests | Logical clock owns time; scheduler only asks how many ticks are owed ([02](./docs/02-market-domain.md#4-logical-market-clock)) |
| `bigint` leaks into `JSON.stringify` | Runtime `TypeError` in production | Decimal strings at the boundary; serializer test over every message type |
| Chart adapter leaks on unmount / interval switch | Memory growth, ghost series | Explicit dispose; adapter owns every handle; leak test in P9 |
| Vercel ↔ Fly CORS / WSS misconfiguration | Works locally, dead in production | `ALLOWED_ORIGINS` env, smoke test against deployed URLs in CI |
| Background-tab suspension drops messages silently | Book diverges without a gap signal | Hard refresh after long hide ([04](./docs/04-frontend.md#12-browser-visibility)) |
| UI polish crowds out correctness work | The graded part is weakest | Effort budget above is a constraint, not a suggestion |
| Two backend replicas generate different markets | Clients disagree | Single authoritative instance; scaling path documented only ([adr/0004](./docs/adr/0004-no-redis-nats.md)) |
| Late response merged into the wrong symbol | Silently wrong book that looks plausible | `symbol` validation + generation id + per-symbol synchronisers; test T6 ([04 §6](./docs/04-frontend.md#6-symbol-switching)) |
| Ticket expiry mistaken for session expiry | Healthy sockets killed every 60 s | Ticket authorises the connect only; explicit test in T7 ([adr/0007](./docs/adr/0007-ws-auth-ticket.md)) |
| Ticket fetch bypasses backoff on a down backend | Reconnect storm against a dead API | Fetch happens inside the backoff delay ([04 §4](./docs/04-frontend.md#4-authentication)) |
| Five engines make one tick loop slow | Cadence drift under load | One logical clock; work is O(symbols × depth) and tiny at 25 levels — measure in P2 |

---

## Decisions

Settled 2026-09-20. Do not relitigate without an ADR.

| Question | Decision |
| --- | --- |
| Multi-symbol? | Five symbols — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — each a fully independent engine ([adr/0006](./docs/adr/0006-per-symbol-engines.md)) |
| Auth on the WebSocket? | Yes — short-lived single-use connect tickets ([adr/0007](./docs/adr/0007-ws-auth-ticket.md)) |
| Rate limiting? | Yes — per-connection token buckets by frame type, 3 strikes → close `4429`; per-IP limits on REST ([01 §8](./docs/01-protocol.md#8-rate-limiting)) |
| Book depth? | `25` per side, `MARKET_BOOK_DEPTH` |
| Trade-batch cadence? | Tier-scaled: `5Hz` / `2Hz` / `0.5Hz` alongside candles ([03 §2](./docs/03-adaptive-delivery.md#2-delivery-scheduler)) |
| Hidden-tab hard refresh? | `30s` (`VISIBILITY_HARD_REFRESH_MS`) |
| Responsive layout? | Required, three breakpoints ([04 §13](./docs/04-frontend.md#responsive-layout)) |
| Router? | App Router, thin server shell ([adr/0008](./docs/adr/0008-app-router.md)) |
| Watchlist reordering (bonus)? | In scope — P10, persisted per browser |

## Open questions

Carried until answered. Do not silently decide these.

- A `ticker` channel for live per-row prices in the watchlist — deferred, not rejected
  ([01 open questions](./docs/01-protocol.md#open-questions)). The watchlist works without it.
- `bufferedAmount` backpressure thresholds — pick in P6 and record them in
  [`03`](./docs/03-adaptive-delivery.md).
