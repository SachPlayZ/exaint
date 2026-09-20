# tasks/todo.md — live progress

Phase definitions, DoD, and docs-to-read live in [`../PLAN.md`](../PLAN.md).
Check items off as they complete. Do not check an item without evidence
([`../AGENTS.md §6`](../AGENTS.md#6-definition-of-done-phase-gate)).

**Current phase:** P4 (not started). P0–P3 complete — scaffold, protocol contracts, deterministic
five-symbol market domain, and the canonical candle engine; 145 passing tests. See § Review.

**Settled decisions:** 5 symbols (BTC/ETH/SOL/HYPE/ZEC), WS connect tickets, per-connection rate
limits, book depth 25/side, tier-scaled trade cadence, 30 s hidden-tab hard refresh. See
[`../PLAN.md` § Decisions](../PLAN.md#decisions).

---

## P0 — Scaffold

- [x] `pnpm-workspace.yaml`, `turbo.json`, root `package.json` with the standard scripts
- [x] `apps/web` — Next.js 16.3.5, App Router, TS strict
- [x] `apps/api` — Fastify 5 + TS
- [x] `packages/protocol` — empty but buildable, importable as `@repo/protocol`
- [x] `tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`
- [x] ESLint + Prettier + Vitest config
- [x] `.env.example` for both apps
- [x] GitHub Actions PR workflow: install → lint → typecheck → test → build
- [x] **Gate:** clean clone runs `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## P1 — Protocol contracts

- [x] `market.ts` — Symbol, Trade, BookSnapshot, BookDelta, Candle, Interval, Tier, NetworkReport, Channel
- [x] `rest.ts` — symbols / snapshot / history / health / ticket shapes
- [x] `websocket.ts` — all client + server frames, discriminated on `type`
- [x] `auth.ts` — ticket payload, error codes, close codes
- [x] `schemas.ts` — Zod source of truth, types via `z.infer`
- [x] decimal-string ↔ `bigint` codecs + tests
- [x] **Gate:** every example in `01-protocol.md` parses; malformed variants rejected with the
      documented code

## P2 — Deterministic market domain

- [x] `prng.ts` — splitmix64, per-symbol seed derived from `MARKET_SEED` (default `1337`)
- [x] `clock.ts` — one 50 ms logical tick, owed-ticks scheduler, drives all engines
- [x] `symbol-registry.ts` — BTC / ETH / SOL / HYPE / ZEC with per-symbol tick size, base price, volatility
- [x] `generator.ts` — limit order / cancel-update / market trade
- [x] `orderbook/` — 25 levels/side, replenishment, per-symbol `bookSequence`, snapshot + delta emission
- [x] `fixed-point.ts` — scales 4 / 8, all `bigint`, uniform across symbols
- [x] **Gate:** same seed ⇒ identical stream for all 5; buys consume asks; bid < ask property;
      per-symbol sequence +1 with no shared counters; symbols visibly differ

## P3 — Candle engine

- [x] `aggregator.ts` — 1s / 5s / 1m per symbol (15 total), fan-out within a symbol only
- [x] candle shape incl. `tradeCount`, `lastTradeId`
- [x] bucket boundary maths
- [x] ring-buffer history per interval (360 = 300 + 20% headroom)
- [x] finalisation events
- [x] **Gate:** OHLCV tests incl. boundary + empty intervals; exact `bigint` volume

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

- [ ] header: watchlist (from `GET /v1/markets`), price, change, status, RTT, tier
- [ ] **watchlist reordering (bonus)** — drag + keyboard, `localStorage` order behind try/catch,
      registry order as fallback, reorder never switches symbol
- [ ] **responsive** — breakpoints ≥1280 / ≥768 / <768, no horizontal scroll, debounced
      `ResizeObserver` chart refit, chart gestures vs page scroll
- [ ] order book with cumulative depth bars, **≥10 bids and ≥10 asks visible at every breakpoint**,
      non-colour-only direction
- [ ] recent trades, capped at 50 for the selected symbol
- [ ] per-symbol price/qty formatting from the registry
- [ ] empty states: zero candles / zero trades / empty book all render cleanly
- [ ] debug drawer incl. symbol, auto vs effective tier, candle + trade target vs actual Hz, 4 buttons
- [ ] **Gate:** steady frame rate under load; no per-packet React render; 10 levels/side at 1280,
      768 and 375px; watchlist order survives reload

## P11 — Failure handling

- [ ] network failure
- [ ] missing book event
- [ ] invalid JSON
- [ ] late history
- [ ] late snapshot after a symbol switch
- [ ] empty history (and empty book, empty trade list)
- [ ] duplicate candle
- [ ] expired ticket on reconnect
- [ ] rate-limit strike close (4429)
- [ ] hidden tab — under 30 s and over 30 s
- [ ] backend restart
- [ ] resource teardown audit vs `04 §14` table — timers, listeners, rAF, observers, sockets
- [ ] **Gate:** each has its own passing automated test; no leaks after 50 symbol switches

## P12 — E2E, deploy, README, recording

- [ ] Playwright recovery suite (block WS messages, offline emulation, symbol switch)
- [ ] Dockerfile: Node 24 LTS, non-root, healthcheck, multi-stage, prod deps only
- [ ] Fly.io backend, Vercel frontend, HTTPS + WSS, `AUTH_MODE=ticket` + real secret
- [ ] structured logs + all symbol-labelled and auth/rate-limit counters
- [ ] README: architecture, state management, protocols, sync, latency/jitter, tiers, recovery,
      debug controls, **Packages used**, **Router choice**, local dev, deployment, **Known
      limitations**, **Bonus features**
- [ ] repo public, clean history, no secrets committed
- [ ] main-branch CI: test → build → docker → deploy
- [ ] 90–120 s screen recording per the demo script
- [ ] **Gate:** green CI on main; both deployments reachable; recording linked from README

---

## Review

### P0 — Scaffold (complete)

**What changed.** pnpm workspace (`apps/*`, `packages/*`) driven by Turborepo. Three packages:
`@repo/api` (Fastify 5, `tsx watch` dev, `tsc` build, no routes — P4 owns those), `@repo/web`
(Next.js 16.3.5 App Router, React 19, Tailwind v4), `@repo/protocol` (buildable, exports
`PROTOCOL_VERSION`; the Zod schemas land in P1). Shared `tsconfig.base.json` with `strict` and
`noUncheckedIndexedAccess`; shared flat ESLint config at the repo root that every package
re-exports; Prettier over code and config only. `.env.example` for both apps, mirroring
`docs/06-ops-deploy.md §3`. GitHub Actions PR workflow: install → lint → typecheck → test → build
on Node 24.

**Verified.** From a clean clone of the committed tree: `pnpm install` → `pnpm lint` →
`pnpm typecheck` → `pnpm test` (3 tests) → `pnpm build` all exit 0. `pnpm dev:api` listens on
:8080 and logs JSON lines; `pnpm dev:web` serves :3000 with `@repo/protocol` resolving through the
workspace link.

**Deviations from PLAN.md, and why.**
- ESLint pinned to 9.x, not 10.x: `eslint-plugin-import` and `eslint-plugin-react`, both
  transitive deps of `eslint-config-next@16.3.5`, do not yet declare ESLint 10 support.
- TypeScript pinned to 5.9.x, not 7.x: `typescript-eslint@8` peer-requires `<6.1.0`.
- `engines.node` is `>=22.12.0`; Docker and CI still run Node 24
  (`docs/06-ops-deploy.md §4`).

**Still open.**
- Type-aware linting and the dependency-direction boundary rule promised in `AGENTS.md §5` —
  deferred until there is real code for them to constrain.
- `pnpm test:e2e` is wired as a Turbo task but no package defines it yet; Playwright lands in P12.
- `docker-compose.yml`, the Dockerfile, and the `main`-branch deploy pipeline are P12.

### P1 — Protocol contracts (complete)

**What changed.** `packages/protocol` now owns the contract: `decimal.ts` (decimal-string ↔
`bigint`, price scale 4 / quantity scale 8), `market.ts`, `auth.ts`, `rest.ts`, `websocket.ts`, and
a `schemas.ts` barrel. Every type is `z.infer` of its schema — nothing is written twice.
`decodeClientFrame` / `decodeServerFrame` return a result value rather than throwing, and map a
validation failure onto the documented error code by the field that broke.

**Verified.** 61 tests, all green (`pnpm test`): 57 in `@repo/protocol`, 4 in `@repo/api`.
- `doc-examples.test.ts` *reads* `docs/01-protocol.md`, extracts all 17 JSON examples and asserts
  each one parses against an exported schema — so a doc example cannot drift from the code.
- `client-frames.test.ts` pins 17 malformed variants to their documented codes
  (`INVALID_MESSAGE` / `UNKNOWN_TYPE` / `INVALID_INTERVAL` / `INVALID_CHANNEL`), proves garbage
  never throws, and pins the tier cadences and `DEGRADED` initial tier.
- `apps/api/tests/protocol-import.test.ts` proves `@repo/protocol` resolves from the api
  workspace; the web build proves it from the web workspace.

**Doc divergences resolved (AGENTS.md §10).**
- `candles.update` examples in `01 §6` and `03 §2` said `start`; the field is `startTime`
  (`02 §8`). `01 §6` is now a complete normative example.
- The `POST /v1/auth/ticket` example carried a truncated ticket that no ticket schema could accept;
  it is now a real HMAC over the documented payload with the dev secret.
- `tier.changed` had a prose field list only; it is now a normative example naming
  `candlesUpdateMs` / `tradesBatchMs`.
- `01 §4` now states the `limit` clamp (`300`) and the `/healthz` + `/readyz` bodies.
- `01 §2` now states that the schema validates symbol *shape*, and the registry validates
  *membership* — which is what keeps the symbol list out of the frontend.
- `01 §1` file tree gained `decimal.ts`; `02 §8` notes the wire-only `final` field.

**Decisions taken here, worth knowing.**
- `subscribed` acknowledges any subscription change and carries the resulting `channels` (empty
  after an `unsubscribe`) plus `interval` (`null` when no candle channel).
- Unknown extra fields are stripped, not rejected — `01 §9` says additive fields are not breaking.
- `UNKNOWN_SYMBOL` is never produced by a schema; a well-formed symbol the registry does not serve
  is a gateway decision (P5).

**Still open.**
- WS per-frame-type rate-limit buckets and the `MAX_FRAME_BYTES` default stay in `apps/api` config
  (P5); `decodeClientFrame` takes `maxBytes` as an argument rather than owning the number.
- `next-env.d.ts` is now generated by `next typegen` during `pnpm typecheck` instead of being
  committed — Next rewrites it differently after `dev` than after `build`, which dirtied the tree.

### P2 — Deterministic market domain (complete)

**What changed.** `apps/api/src/market/` — `fixed-point.ts`, `simulator/prng.ts` (splitmix64 +
FNV-1a seed derivation), `simulator/clock.ts`, `simulator/generator.ts`, `orderbook/order-book.ts`,
`symbol-config.ts`, `symbol-engine.ts`, `symbol-registry.ts`, `market-engine.ts`, plus
`loadMarketConfig` for `MARKET_SYMBOLS` / `MARKET_SEED` / `MARKET_BOOK_DEPTH` / `MARKET_TICK_MS`.
Largest file is 212 lines. Nothing in this layer imports Fastify.

**Verified.** 107 tests green (57 protocol, 50 api), `lint`/`typecheck`/`build` clean.
- splitmix64 and FNV-1a are checked against their **published reference vectors**, not against
  themselves.
- `determinism.test.ts`: two engines, same seed and start time, 600 ticks → byte-identical trade
  and delta streams for all five symbols; a different `MARKET_SEED` changes every symbol; moving
  only the start time shifts timestamps and nothing else; a 5 s wall-clock stall catches up to the
  same ticks in the same order as a steady 50 ms loop.
- Per-symbol independence: `ETH-USD` alone replays identically to `ETH-USD` inside the full
  five-symbol registry — the streams cannot cross-contaminate.
- `simulator.test.ts`: every buy fills from asks and every sell from bids, at prices that were
  actually resting and for no more than was there; no zero-quantity prints; every price is a whole
  multiple of that symbol's `tickSize`; both sides hold exactly 25 levels.
- `bid < ask` is a **fast-check property** over arbitrary seeds and tick counts, asserting the whole
  ladder is uncrossed, not just the touch.
- `order-book.test.ts` mirrors the server book from a snapshot plus the delta chain and asserts
  they match level for level (I1, server side), and that a no-op tick burns no sequence number.

**Design decisions worth knowing.**
- **The book holds exactly the visible window.** Trimming emits `0` deletes for evicted levels, so
  there is no hidden liquidity outside the 25 for a delta to silently reveal — which is what makes
  the client's delta chain reproduce the authoritative book exactly.
- **The ladder is a grid, not 25 adjacent ticks.** 25 ticks on `BTC-USD` spans `2.50` — a third of
  a basis point — so the entire book would be rewritten several times a second. Levels are grouped
  to a per-symbol `levelSpacing` (a whole multiple of `tickSize`); trades still print at any tick.
- **Price discovery happens by trading through stale quotes**, not by deleting them. That is what
  makes "a buy print at a price no ask ever offered" structurally impossible rather than merely
  unobserved.
- **No floating point in the PRNG path.** The bell-shaped step is the mean of three uniform integer
  draws, not Box–Muller: `Math.log`/`Math.cos` are not bit-identical across JS engines, and a
  replay test that only holds on one machine is not a determinism test.
- `flushDelta` returns `null` when nothing changed. A no-op tick must not advance `bookSequence`,
  or every client would see a gap on an idle market.

**Constants chosen here (were not in the docs).** The registry table gave base price, tick size and
trade size, and a qualitative "Character" column, but no volatility, spread, level spacing or
resting size. Those are now picked, justified, and recorded in `docs/02-market-domain.md §2
Calibration`, together with the measured spreads and one-minute ranges the test asserts.

**Still open.**
- Catch-up is unbounded: after a long stall `runOwedTicks` runs every owed tick in one pass. A cap
  belongs with the scheduler that will own it — raised in `docs/02-market-domain.md` open
  questions, to settle in P4/P5.
- `MarketEngine` exposes a tick sink rather than a `MarketEventBus`; the bus lands when a transport
  needs it (P4/P5).

### P3 — Candle engine (complete)

**What changed.** `apps/api/src/market/candles/`: `candle.ts` (domain shape + bucket boundary),
`ring-buffer.ts` (O(1) fixed-capacity history), `aggregator.ts` (one symbol, one interval),
`symbol-candles.ts` (a symbol's three). `SymbolEngine` now owns a `SymbolCandleSet`, and
`SymbolTickResult` carries `finalisedCandles` and `activeCandles`. No tier awareness anywhere in
this layer.

**Verified.** 145 tests green (57 protocol, 88 api), `lint`/`typecheck`/`build` clean.
- `candle-engine.test.ts` runs the real five-symbol engine for two simulated minutes and compares
  all 15 aggregators against an **independent fold of the raw trade stream** — same OHLCV, same
  volume, same `tradeCount`, same `lastTradeId`, nothing invented and nothing lost.
- Every finalised candle is emitted exactly once, per interval, in chronological order.
- Volume exactness is a fast-check property over arbitrary quantity lists, plus a 10,000-trade case
  that shows the `bigint` sum exact where the float accumulator has already drifted.
- Boundary cases covered: single-trade candle, a trade landing exactly on a boundary, quiet-market
  finalisation on the clock, and double-close protection.

**Design decisions worth knowing.**
- **An empty interval produces no candle.** A bucket with no trades is a gap in the series, never a
  fabricated zero-volume bar — asserted directly.
- **Buckets finalise on the clock, not only on the next trade.** `closeThrough(timestamp)` runs
  every tick before the trades are folded, so a bucket that ends while the market is quiet still
  closes. Without it a Minimal client could wait seconds for a candle that had already closed,
  which is exactly the I2 failure P6 has to avoid.
- **No `final` field on the domain candle.** Finality is a fact about the clock; the transport
  states it on the wire so the client never infers it. Recorded in `docs/02-market-domain.md §8`
  during P1.
- `activeCandles` is emitted only on ticks that saw a trade, so the delivery layer is not handed an
  unchanged active candle 20 times a second.
- Ring-buffer capacity is `CANDLE_HISTORY_LIMIT_MAX * 1.2 = 360`, derived from the protocol
  constant rather than typed in twice.

**Still open.** Nothing new. The candle *delivery* rules — pending finalised queue, coalesced
active slot, per-tier cadence — are P6, and deliberately live outside this engine.
