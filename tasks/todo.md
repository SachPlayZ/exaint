# tasks/todo.md — live progress

Phase definitions, DoD, and docs-to-read live in [`../PLAN.md`](../PLAN.md).
Check items off as they complete. Do not check an item without evidence
([`../AGENTS.md §6`](../AGENTS.md#6-definition-of-done-phase-gate)).

**Current phase:** P0 (not started) — documentation complete, no code yet.

**Settled decisions:** 5 symbols (BTC/ETH/SOL/HYPE/ZEC), WS connect tickets, per-connection rate
limits, book depth 25/side, tier-scaled trade cadence, 30 s hidden-tab hard refresh. See
[`../PLAN.md` § Decisions](../PLAN.md#decisions).

---

## P0 — Scaffold

- [ ] `pnpm-workspace.yaml`, `turbo.json`, root `package.json` with the standard scripts
- [ ] `apps/web` — Next.js 16.3.x, App Router, TS strict
- [ ] `apps/api` — Fastify + TS
- [ ] `packages/protocol` — empty but buildable, importable as `@repo/protocol`
- [ ] `tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`
- [ ] ESLint + Prettier + Vitest config
- [ ] `.env.example` for both apps
- [ ] GitHub Actions PR workflow: install → lint → typecheck → test → build
- [ ] **Gate:** clean clone runs `pnpm install && pnpm lint && pnpm typecheck && pnpm build`

## P1 — Protocol contracts

- [ ] `market.ts` — Symbol, Trade, BookSnapshot, BookDelta, Candle, Interval, Tier, NetworkReport, Channel
- [ ] `rest.ts` — symbols / snapshot / history / health / ticket shapes
- [ ] `websocket.ts` — all client + server frames, discriminated on `type`
- [ ] `auth.ts` — ticket payload, error codes, close codes
- [ ] `schemas.ts` — Zod source of truth, types via `z.infer`
- [ ] decimal-string ↔ `bigint` codecs + tests
- [ ] **Gate:** every example in `01-protocol.md` parses; malformed variants rejected with the
      documented code

## P2 — Deterministic market domain

- [ ] `prng.ts` — seeded PCG/xorshift, per-symbol seed derived from `MARKET_SEED` (default `1337`)
- [ ] `clock.ts` — one 50 ms logical tick, owed-ticks scheduler, drives all engines
- [ ] `symbol-registry.ts` — BTC / ETH / SOL / HYPE / ZEC with per-symbol tick size, base price, volatility
- [ ] `generator.ts` — limit order / cancel-update / market trade
- [ ] `orderbook/` — 25 levels/side, replenishment, per-symbol `bookSequence`, snapshot + delta emission
- [ ] `fixed-point.ts` — scales 4 / 8, all `bigint`, uniform across symbols
- [ ] **Gate:** same seed ⇒ identical stream for all 5; buys consume asks; bid < ask property;
      per-symbol sequence +1 with no shared counters; symbols visibly differ

## P3 — Candle engine

- [ ] `aggregator.ts` — 1s / 5s / 1m per symbol (15 total), fan-out within a symbol only
- [ ] candle shape incl. `tradeCount`, `lastTradeId`
- [ ] bucket boundary maths
- [ ] ring-buffer history per interval (≥ 300 + headroom)
- [ ] finalisation events
- [ ] **Gate:** OHLCV tests incl. boundary + empty intervals; exact `bigint` volume

## P4 — REST API

- [ ] `GET /v1/markets` — symbol registry
- [ ] `GET /v1/markets/:symbol/book`
- [ ] `GET /v1/markets/:symbol/candles?interval=&limit=`
- [ ] `POST /v1/auth/ticket` — HMAC, 60 s, single-use
- [ ] `GET /healthz`, `/readyz`, `/metrics`
- [ ] CORS from `ALLOWED_ORIGINS`; per-IP REST rate limits
- [ ] **Gate:** schema-validated responses; no duplicate `startTime`; `limit` clamp documented;
      `/readyz` waits for every engine's first tick

## P5 — WebSocket gateway

- [ ] `/v1/ws?ticket=` endpoint
- [ ] `AuthService` — mint / verify / single-use, close codes 4401 + 4408
- [ ] `RateLimiter` — per-frame-type + global buckets, 3 strikes → close 4429
- [ ] `ConnectionSession` + `SymbolSubscription` with the full field lists
- [ ] all six client frames (incl. `channels`), all eight server frames
- [ ] Zod validation + `INVALID_MESSAGE` without dropping the connection
- [ ] heartbeat
- [ ] **Gate:** T7 passes; fuzzed garbage survives; two connections hold different symbols and
      intervals; a connection outlives its ticket's `exp`

## P6 — Adaptive delivery

- [ ] `tier-controller.ts` — EWMA α=0.2, all four hysteresis transitions, initial `DEGRADED`
- [ ] missing-report ladder 15 s / 30 s / 45 s
- [ ] `delivery-scheduler.ts` — candles 10/2/0.5 Hz **and** trades 5/2/0.5 Hz, per symbol
      subscription; pending finalised + coalesced active
- [ ] `debug.tier_override` affects `effectiveTier` only
- [ ] backpressure policy on `bufferedAmount` (record chosen thresholds in `03`)
- [ ] **Gate:** T1 + T3 pass; three concurrent tiers, also on three different symbols; Minimal
      loses no finalised candle; both cadences move with tier

## P7 — Frontend networking

- [ ] `MarketSocketClient` (no React)
- [ ] ticket fetched fresh per attempt, inside the backoff; never cached, never in `localStorage`
- [ ] close-code handling: 4401 / 4408 → new ticket; 4429 → backoff; 4409 → resync
- [ ] backoff 250 ms → 10 s with jitter, reset after stability
- [ ] 2 s ping via `performance.now()`, 5 s `network.report`
- [ ] connection state machine (6 states)
- [ ] Zustand store + TanStack Query wiring
- [ ] **Gate:** socket client unit-tested React-free; reconnect follows the 9 documented steps

## P8 — Order-book synchroniser

- [ ] buffer-then-snapshot, 9 steps
- [ ] one synchroniser instance per symbol
- [ ] gap → `RESYNCING` for that symbol only, previous book stays visible and marked
- [ ] `bookStatus` states
- [ ] **Gate:** T2 + T4 pass; a gap in one symbol leaves the others `SYNCHRONIZED`

## P9 — Chart

- [ ] `CandlestickChartAdapter` with explicit dispose on unmount and every switch
- [ ] symbol switching: subscribe-before-unsubscribe, per-symbol sync, `tickSize` formatting
- [ ] interval switching: query key + AbortSignal + response validation + generation id
- [ ] ignore WS frames for a non-selected symbol or interval
- [ ] history/realtime merge, dedupe by `symbol + interval + candleStart`, higher `lastTradeId` wins
- [ ] crosshair, hover OHLCV, pan, zoom
- [ ] **Gate:** T5 + T6 pass; no chart update path goes through React state; exactly one
      subscription left after a switch

## P10 — UI + debug panel

- [ ] header: symbol switcher (from `GET /v1/markets`), price, change, status, RTT, tier
- [ ] order book with cumulative depth bars, 25 levels/side, non-colour-only direction
- [ ] recent trades, capped at 50 for the selected symbol
- [ ] per-symbol price/qty formatting from the registry
- [ ] debug drawer incl. symbol, auto vs effective tier, candle + trade target vs actual Hz, 4 buttons
- [ ] **Gate:** steady frame rate under load; no per-packet React render

## P11 — Failure handling

- [ ] network failure
- [ ] missing book event
- [ ] invalid JSON
- [ ] late history
- [ ] late snapshot after a symbol switch
- [ ] duplicate candle
- [ ] expired ticket on reconnect
- [ ] rate-limit strike close (4429)
- [ ] hidden tab — under 30 s and over 30 s
- [ ] backend restart
- [ ] **Gate:** each has its own passing automated test

## P12 — E2E, deploy, README, recording

- [ ] Playwright recovery suite (block WS messages, offline emulation, symbol switch)
- [ ] Dockerfile: Node 24 LTS, non-root, healthcheck, multi-stage, prod deps only
- [ ] Fly.io backend, Vercel frontend, HTTPS + WSS, `AUTH_MODE=ticket` + real secret
- [ ] structured logs + all symbol-labelled and auth/rate-limit counters
- [ ] README filled against the §53 structure with inline diagrams
- [ ] main-branch CI: test → build → docker → deploy
- [ ] 90–120 s screen recording per the demo script
- [ ] **Gate:** green CI on main; both deployments reachable; recording linked from README

---

## Review

*(Filled at the end of each phase: what changed, what was verified, what is still open.)*
