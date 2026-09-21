# tasks/todo.md — live progress

Phase definitions, DoD, and docs-to-read live in [`../PLAN.md`](../PLAN.md).
Check items off as they complete. Do not check an item without evidence
([`../AGENTS.md §6`](../AGENTS.md#6-definition-of-done-phase-gate)).

**Current phase:** P12 reopened — production CI/deploy is green, but the Vercel app cannot bootstrap
through the EC2 API because production CORS is misconfigured. The audit below also reopened three
delivery-state defects, documentation cleanup, and the missing screen recording.

**Settled decisions:** 5 symbols (BTC/ETH/SOL/HYPE/ZEC), WS connect tickets, per-connection rate
limits, book depth 25/side, tier-scaled trade cadence, 30 s hidden-tab hard refresh. See
[`../PLAN.md` § Decisions](../PLAN.md#decisions).

## Active documentation — README rewrite

### Plan

- [ ] Review current implementation, architecture docs, assignment, and reference READMEs
- [ ] Rewrite `README.md` with live URLs, concise architecture, protocols, recovery, and setup
- [ ] Document accurate adaptive thresholds, debug controls, lifecycle behavior, and limitations
- [ ] Verify links, formatting, commands, deployed endpoints, and README coverage
- [ ] Inspect the final diff without disturbing concurrent implementation work

### Files likely touched

- `README.md`, `tasks/todo.md`

### Verification

- [ ] `pnpm exec prettier --check README.md tasks/todo.md`
- [ ] Link/path and required-section audit
- [ ] Live frontend/API endpoint smoke

### Unresolved questions

- None.

## Active audit — assignment end-to-end coverage

### Plan

- [x] Map every assignment requirement to implementation, tests, docs, or deliverable evidence
- [x] Audit backend/protocol correctness and adaptive delivery
- [x] Audit frontend behavior, synchronization, recovery, responsiveness, and lifecycle
- [x] Verify lint, typecheck, unit/property tests, E2E, and production builds
- [x] Smoke-test the running API and browser UI
- [x] Verify public/deployed deliverables and identify external gaps

### Files likely inspected

- `apps/api/`, `apps/web/`, `packages/protocol/`, `docs/`, `README.md`
- `.github/workflows/`, deployment configuration, `PLAN.md`, `tasks/todo.md`

### Verification

- [x] Requirement matrix supported by exact file/test/runtime evidence
- [x] Full repository quality gates
- [x] Live REST/WebSocket/UI smoke evidence

### Unresolved questions

- None.

### Review

#### Changed

- No application behavior changed; audit evidence only.

#### Verified

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (338 tests), `pnpm test:e2e` (4 tests), and
  `pnpm build` pass.
- Local REST, ticketed WebSocket, and browser UI work; production API/WSS and main CI are healthy.
- Public repository and independently deployed EC2/Vercel services exist.

#### Risks

- Production frontend cannot bootstrap because the API omits CORS permission for its Vercel origin.
- Missing-report demotion reaches `MINIMAL` at 20 s instead of the documented 30 s.
- Interval switches can relabel queued old-interval candles; a final candle can also be emitted as active.
- The required screen recording is missing; README has material protocol/configuration drift.
- WebSocket request logs include the connect ticket in the URL.

#### Follow-ups

- Fix the production CORS environment and add a browser-origin deployment smoke test.
- Fix the three delivery-state defects and add focused regressions.
- Correct README/debug setup/test links, redact ticket query strings, and add the demo recording.

## Active diagnosis — candle visual inconsistency

### Plan

- [x] Trace canonical trades through candle aggregation and chart conversion
- [x] Inspect real candle output for invalid OHLC values, gaps, and sparse buckets
- [x] Identify whether the screenshot is expected market shape or a defect

### Files likely inspected

- `apps/api/src/market/{simulator,candles}/`, `apps/web/features/market/chart/`
- `docs/02-market-domain.md`, `docs/04-frontend.md`, `tasks/todo.md`

### Verification

- [x] Focused candle and chart tests (42 passed)
- [x] Concrete 120-second deterministic sample across all symbols and intervals

### Unresolved questions

- None.

### Review

#### Changed

- No application behavior changed; diagnosis only.

#### Verified

- Every sampled candle satisfied OHLC bounds; every sampled 1s/5s bucket was contiguous.
- 1s opens differed from the preceding close in 72–93% of transitions, depending on symbol.
- 1s doji candles accounted for 8–25% of the sample, explaining the line-like bodies.

#### Risks

- The output is mathematically valid but visually noisy because a bucket opens at its first actual
  trade, which can jump across the simulated spread from the preceding bucket's final trade.

#### Follow-ups

- Implement the approved simulator calibration and 5s default below.

## Active implementation — smoother trade-derived candles

### Plan

- [ ] Add deterministic order-flow persistence to noise trades
- [ ] Tighten configured spreads and reduce fair-value volatility
- [ ] Keep canonical first-trade OHLC semantics unchanged
- [ ] Change the terminal default interval from 1s to 5s
- [ ] Update owning docs and add focused regression coverage
- [ ] Run focused tests, full quality gates, sample output, and diff review

### Files likely touched

- `apps/api/src/market/simulator/generator.ts`, `apps/api/src/market/symbol-config.ts`
- `apps/api/tests/market/{simulator,registry}.test.ts`
- `apps/web/features/market/runtime/terminal-runtime.ts`
- `apps/web/features/market/terminal/trading-terminal.tsx`
- `docs/02-market-domain.md`, `docs/04-frontend.md`, `tasks/todo.md`

### Verification

- [ ] Determinism, trade/book coherence, candle validity, and visual continuity regression
- [ ] Terminal initially subscribes and fetches candle history at 5s
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- [ ] Inspect final diff for unrelated changes

### Unresolved questions

- None.

## Active plan — P12 EC2 deployment migration

### Plan

- [x] Replace Fly.io configuration and CI steps with a single-instance EC2 Docker deployment
- [x] Keep secrets out of the repository and document required EC2/GitHub/Vercel configuration
- [x] Repair the Docker build so frozen pnpm installs use the repository configuration
- [x] Update PLAN, ops docs, README, and stale P12 claims to match EC2
- [x] Verify workflow syntax, lint, typecheck, tests, build, E2E, and Docker build where available
- [x] Inspect the final diff for unrelated changes

### Files touched

- `Dockerfile`, `deploy/ec2/*`, `apps/api/src/config/env.ts`, `apps/api/src/app/build-server.ts`
- `.github/workflows/main.yml`, `apps/web/vercel.json`
- `PLAN.md`, `docs/06-ops-deploy.md`, `docs/adr/0009-ec2-deployment.md`, `README.md`
- `tasks/todo.md`

### Verification

- [x] Workflow YAML parses and passes `actionlint`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test` (338 tests)
- [x] `pnpm test:e2e` (4 Playwright recovery flows)
- [x] `pnpm build`
- [x] Docker API image builds and non-root health/readiness checks pass
- [x] Ticketed WebSocket smoke passes against the built API image
- [x] Inspect `git diff` and confirm only deployment migration files changed

### Unresolved questions

- None. Default deployment is one EC2 host reached through SSM, with ECR images and Caddy HTTPS/WSS.

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

- [x] `GET /v1/markets` — symbol registry
- [x] `GET /v1/markets/:symbol/book`
- [x] `GET /v1/markets/:symbol/candles?interval=&limit=`
- [x] `POST /v1/auth/ticket` — HMAC, 60 s, single-use
- [x] `GET /healthz`, `/readyz`, `/metrics`
- [x] CORS from `ALLOWED_ORIGINS`; per-IP REST rate limits
- [x] **Gate:** schema-validated responses; no duplicate `startTime`; `limit` clamp documented;
      `/readyz` waits for every engine's first tick

## P5 — WebSocket gateway

- [x] `/v1/ws?ticket=` endpoint
- [x] `AuthService` — mint / verify / single-use, close codes 4401 + 4408
- [x] `RateLimiter` — per-frame-type + global buckets, 3 strikes → close 4429
- [x] `ConnectionSession` + `SymbolSubscription` with the full field lists
- [x] all six client frames (incl. `channels`), seven of eight server frames
      (`tier.changed` is P6)
- [x] Zod validation + `INVALID_MESSAGE` without dropping the connection
- [x] heartbeat
- [x] **Gate:** T7 passes; fuzzed garbage survives; two connections hold different symbols and
      intervals; a connection outlives its ticket's `exp`

## P6 — Adaptive delivery

- [x] `tier-controller.ts` — all four hysteresis transitions, initial `DEGRADED` (the EWMA is the
      client's, per `03 §4`)
- [x] missing-report ladder 15 s / 30 s / 45 s
- [x] `delivery-scheduler.ts` — candles 10/2/0.5 Hz **and** trades 5/2/0.5 Hz, per symbol
      subscription; pending finalised + coalesced active
- [x] `debug.tier_override` affects `effectiveTier` only
- [x] backpressure policy on `bufferedAmount` (thresholds recorded in `03 §9`)
- [x] **Gate:** T1 + T3 pass; three concurrent tiers, also on three different symbols; Minimal
      loses no finalised candle; both cadences move with tier

## P7 — Frontend networking

- [x] `MarketSocketClient` (no React)
- [x] ticket fetched fresh per attempt, inside the backoff; never cached, never in `localStorage`
- [x] close-code handling: 4401 / 4408 → new ticket; 4429 → backoff; 4409 → resync
- [x] backoff 250 ms → 10 s with jitter, reset after stability
- [x] 2 s ping via `performance.now()`, 5 s `network.report`
- [x] connection state machine (6 states)
- [x] Zustand store + TanStack Query wiring
- [x] **Gate:** socket client unit-tested React-free; reconnect follows the 9 documented steps

## P8 — Order-book synchroniser

- [x] buffer-then-snapshot, 9 steps
- [x] one synchroniser instance per symbol
- [x] gap → `RESYNCING` for that symbol only, previous book stays visible and marked
- [x] `bookStatus` states
- [x] **Gate:** T2 + T4 pass; a gap in one symbol leaves the others `SYNCHRONIZED`

## P9 — Chart

- [x] `CandlestickChartAdapter` with explicit dispose on unmount and every switch
- [x] symbol switching: subscribe-before-unsubscribe, per-symbol sync, `tickSize` formatting
- [x] interval switching: query key + AbortSignal + response validation + generation id
- [x] ignore WS frames for a non-selected symbol or interval
- [x] history/realtime merge, dedupe by `symbol + interval + candleStart`, higher `lastTradeId` wins
- [x] crosshair, hover OHLCV, pan, zoom
- [x] **Gate:** T5 + T6 pass; no chart update path goes through React state; exactly one
      subscription left after a switch

## P10 — UI + debug panel

- [x] header: watchlist (from `GET /v1/markets`), price, change, status, RTT, tier
- [x] **watchlist reordering (bonus)** — drag + keyboard, `localStorage` order behind try/catch,
      registry order as fallback, reorder never switches symbol
- [x] **responsive** — breakpoints ≥1280 / ≥768 / <768, no horizontal scroll, debounced
      `ResizeObserver` chart refit, chart gestures vs page scroll
- [x] order book with cumulative depth bars, **≥10 bids and ≥10 asks visible at every breakpoint**,
      non-colour-only direction
- [x] recent trades, capped at 50 for the selected symbol
- [x] per-symbol price/qty formatting from the registry
- [x] empty states: zero candles / zero trades / empty book all render cleanly
- [x] debug drawer incl. symbol, auto vs effective tier, candle + trade target vs actual Hz, 4 buttons
- [x] **Gate:** steady frame rate under load; no per-packet React render; 10 levels/side at 1280,
      768 and 375px; watchlist order survives reload

## P11 — Failure handling

- [x] network failure
- [x] missing book event
- [x] invalid JSON
- [x] late history
- [x] late snapshot after a symbol switch
- [x] empty history (and empty book, empty trade list)
- [x] duplicate candle
- [x] expired ticket on reconnect
- [x] rate-limit strike close (4429)
- [x] hidden tab — under 30 s and over 30 s
- [x] backend restart
- [x] resource teardown audit vs `04 §14` table — timers, listeners, rAF, observers, sockets
- [x] **Gate:** each has its own passing automated test; no leaks after 50 symbol switches

## P12 — E2E, deploy, README, recording

- [x] Playwright recovery suite (block WS messages, offline emulation, symbol switch)
- [x] Dockerfile: Node 24 LTS, non-root, healthcheck, multi-stage, prod deps only
- [ ] Amazon EC2 backend, Vercel frontend, HTTPS + WSS, `AUTH_MODE=ticket` + real secret
- [x] structured logs + all symbol-labelled and auth/rate-limit counters
- [x] README: architecture, state management, protocols, sync, latency/jitter, tiers, recovery,
      debug controls, **Packages used**, **Router choice**, local dev, deployment, **Known
      limitations**, **Bonus features**
- [x] repo public, clean history, no secrets committed
- [x] main-branch CI: test → build → ECR → EC2/Vercel deploy
- [ ] 90–120 s screen recording uploaded and linked
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

### P4 — REST API (complete)

**What changed.** `app/wire.ts` (the single JSON boundary), `auth/ticket-service.ts`,
`market/market-repository.ts`, `app/market-runtime.ts`, `app/create-app.ts`,
`observability/metrics.ts`, and `routes/{health,markets,auth,errors}.ts`. `build-server.ts` now
registers CORS, per-route rate limits, and an error handler; `index.ts` boots the market.

**Verified.** 178 tests green (57 protocol, 121 api), `lint`/`typecheck`/`build` clean, plus a live
`curl` pass against `pnpm dev:api` covering every route, the 404 and the 400.
- Every response is parsed back through its protocol schema in the test, so a shape change breaks
  the build rather than the client.
- History is asserted ascending and unique by `startTime` on all three intervals, with the last
  candle `final: false` and the rest `final: true`.
- `limit` is clamped, not rejected: `99999` returns ≤ 300, `5` returns 5, and the limit bounds the
  whole response including the active candle.
- `/readyz` returns `503` with the pending symbols before the first tick and `200` after.
- Empty history returns `200` with `[]` — a valid state, never an error.
- Ticket tests are the T7 ticket half in full: valid, missing, bad signature, foreign secret,
  tampered payload, expired, replayed, and a consumed-set that is bounded by the TTL.
- `wire.ts` is exercised against 400 ticks of live market: every encoded trade, delta, candle and
  snapshot parses and `JSON.stringify`s — a stray `bigint` there is a production `TypeError`.

**A defect this phase caught.** The P2 order book passed all its tests and was still wrong:
replenishment extended outward from the far edge only, so as the fair value moved the touch
migrated while the old cluster stayed put — gaps of up to 217 grid steps, on 1,195 of 1,200 ticks.
It surfaced from reading a `curl` of `/v1/markets/HYPE-USD/book`. Replenishment now fills empty
slots from the touch outward, contiguity is asserted every tick in
`simulator.test.ts`, and the pattern is recorded in `tasks/lessons.md`.

**Decisions taken here.**
- **Status-code mapping** (`400/404/429/500/503`) and the REST-only `INTERNAL_ERROR` code are now
  in `docs/01-protocol.md §4`. `INTERNAL_ERROR` widens `RestErrorResponseSchema` only — it is never
  a frame code.
- **Bounded catch-up.** `MARKET_MAX_CATCHUP_TICKS` (default `200`) bounds one pass; the remainder
  stays owed, so nothing is skipped. This resolves the open question P2 raised, and is recorded in
  `docs/02-market-domain.md §4` and `docs/06-ops-deploy.md §3`.
- **`AUTH_MODE=off` still mints a ticket**, so the client's connect flow is identical locally; the
  gateway is what stops checking.
- **An ephemeral dev secret.** With `AUTH_MODE=ticket` and no `AUTH_TICKET_SECRET`, a non-production
  process mints a random per-process secret instead of refusing to boot, so a stranger can clone,
  install and `pnpm dev` with no setup (`docs/06-ops-deploy.md §1`). `NODE_ENV=production` still
  throws.
- `TicketService` does mint **and** verify now rather than being split across P4/P5 — a ticket
  service that cannot verify cannot be tested. P5 wires verification into the handshake.

**Still open.**
- `/metrics` carries only the counters that exist by P4; the `ws_*`, `tier_*` and
  `*_delivered{tier}` series arrive with the gateway and the scheduler.
- The rate limiter here is the per-IP REST one. The per-connection token buckets are P5.

### P5 — WebSocket gateway (complete)

**What changed.** `apps/api/src/websocket/`: `rate-limiter.ts`, `connection-session.ts`,
`frame-handler.ts`, `dispatcher.ts`, `gateway.ts`. Largest file is 173 lines. `build-server.ts`
registers the gateway; `create-app.ts` supplies the new `WebSocketConfig`; the metrics registry
gained the `ws_*`, `*_delivered` and `subscriptions_by_symbol` series.

**Verified.** 205 tests green (58 protocol, 147 api), `lint`/`typecheck`/`build` clean, plus a live
`ws://` session against `pnpm dev:api` that produced `hello`, `subscribed`, `pong`, an
`UNKNOWN_TYPE` error, and then 50 `book.delta`, 29 `trades.batch` and 30 `candles.update` frames in
2.5 s.
- **T7 in full.** Ticket half over the real socket: valid → `hello`; missing → `UNAUTHORIZED` +
  `4401`; bad signature → `UNAUTHORIZED` + `4401`; expired → `TICKET_EXPIRED` + `4408`; replayed →
  `TICKET_EXPIRED` + `4408`, with the first connection still open. Rate-limiter half against a fake
  clock: ping at 2/s never limited over 500 pings; a burst of 10 passes exactly 4; the bucket
  refills by elapsed time (half a second buys exactly one token, and never exceeds the burst);
  3 strikes in 10 s closes `4429`; strikes older than 10 s are forgotten.
- **A connection outlives its ticket.** The clock is pushed ten minutes past `exp` and the socket
  still answers a ping. That test exists to stop someone "helpfully" adding session expiry later.
- **Two connections, different symbols and different intervals**, simultaneously, with neither
  seeing the other's frames. Also `set_interval` on one symbol leaving the other's interval alone.
- Fuzzed garbage — empty frames, truncated JSON, arrays, nulls, `__proto__`, a 5 KB id — leaves the
  socket open and still answering.
- Heartbeat is tested end to end by shortening the timeout: a silent socket closes `4000` while a
  chatty one on the same server stays open.
- Teardown: closing a socket drops it from the dispatcher, the `subscriptions_by_symbol` gauge
  returns to 0, and a later tick dispatches without throwing.

**Design decisions worth knowing.**
- **One runtime subscription for the whole process**, not one per socket. The market is computed
  once and every connection is served from it — the structural form of I2.
- **`subscribed` acknowledges state, not the request.** It carries the resulting channels (`[]`
  after an unsubscribe) and interval (`null` whenever `candles` is absent), so a client can never
  read a stale interval off an acknowledgement. Now normative in `docs/01-protocol.md §6`.
- **Heartbeat is inbound silence**, 45 s, close `4000`. Documented in `§5`. Made injectable purely
  so the close path has a real test rather than a 45-second one.
- `debug.tier_override` already sets `effectiveTier` only and is gated by `ENABLE_DEBUG_CONTROLS`;
  `autoTier` is untouched. The `tier.changed` frame and the hysteresis that drives it are P6.
- Delivery is immediate in this phase, by design — the per-connection scheduler is P6. Book deltas
  will stay unpaced either way.

**Still open.**
- `tier.changed`, the tier controller, the delivery scheduler and backpressure are P6.
- `ws_reconnects`, `tier_changes` and `book_resyncs` counters land with the phases that can
  observe them.

### P6 — Adaptive delivery (complete)

**What changed.** `websocket/tier-controller.ts` and `websocket/delivery-scheduler.ts`.
`SymbolSubscription` became a class carrying exactly the fields `docs/03 §8` lists
(`lastCandleSentAt`, `pendingFinalCandles`, `latestActiveCandle`, `lastTradeBatchSentAt`,
`pendingTrades`). The dispatcher now enqueues and flushes through the scheduler, applies
backpressure, and the gateway emits `tier.changed`.

**Verified.** 235 tests green (58 protocol, 177 api), `lint`/`typecheck`/`build` clean.

**T1 — hysteresis**, entirely on a fake clock: promotion takes exactly five good reports, not four;
a single bad sample does not demote; three sustained bad ones do; demotion fires on OR (jitter alone
is enough) while promotion requires AND (good RTT with bad jitter never promotes); an in-between
report resets both counters; `DEGRADED ↔ MINIMAL` shows the same asymmetry; an override moves
`effectiveTier` while `autoTier` keeps climbing to `full` underneath; removing the override lands on
the current `autoTier` with no re-warm-up; the missing-report ladder fires at 15 s and 30 s, and
measures from connect time when no report ever arrived.

**T3 — candle invariance**, three virtual clients over 10,000+ deterministic trades:
- `FULL === DEGRADED === MINIMAL` on final candles, byte for byte.
- All three equal the **canonical** set — equality alone would not catch a candle lost at both ends.
- No finalised candle delivered twice, and all arrive in `startTime` order.
- `tradeCount` per candle matches the canonical count at every tier, so no trade is double-counted
  however the batches fell.
- Repeated with three clients on three different symbols, and again with **one** connection holding
  three symbols — the arrangement that catches a scheduler keyed by connection instead of
  `(connection, symbol)`.

**Demonstrated live.** Three connections held at three tiers on `BTC-USD` for ten seconds against
`pnpm dev:api`:

```text
full      candleFrames 87   tradeFrames 48   | full candles=100ms trades=200ms
degraded  candleFrames 20   tradeFrames 20   | (no change — already degraded)
minimal   candleFrames  5   tradeFrames  5   | minimal candles=2000ms trades=2000ms

final candle values identical across all three tiers: true
```

8.7 Hz / 2.0 Hz / 0.5 Hz against targets of 10 / 2 / 0.5, with `candle_updates_generated` flat at 15
while `candle_updates_delivered` split 87 / 20 / 5 by tier. That pair of counters is the aggregate
form of the same argument, and is now quoted in `docs/06-ops-deploy.md §5`.

**Design decisions worth knowing.**
- **The active slot is cleared after a send, not retained.** Retaining it would re-send an unchanged
  bucket ten times a second on an idle market. The finalised queue still accumulates, so nothing is
  lost — that asymmetry is the whole trick.
- **Changing interval discards candle state** for the old one. Merging a `1s` bucket into a `1m`
  stream would be a silently wrong chart.
- **No server-side smoothing.** `docs/03 §4` puts the EWMA on the client; smoothing the reported
  values again would distort thresholds that are stated against those numbers. `PLAN.md` said
  otherwise and has been corrected.
- **One injected clock per connection** governs cadence, token-bucket refill, the heartbeat and the
  missing-report ladder. Tests advance it explicitly, so no socket test depends on machine speed.
- **Backpressure thresholds** are `256 KiB` soft (drop trade batches) and `1 MiB` hard
  (`BACKPRESSURE_CLOSE`, close `4409`), derived from delta size and rate and recorded in
  `docs/03 §9`. This closes the last open question in that doc.
- `tier.changed` is emitted only when `effectiveTier` actually moves — overriding to the tier a
  connection is already on produces no frame, which a socket test asserts by absence.

**Still open.** Nothing in the backend. P7 starts the frontend.

### P7 — Frontend networking (complete)

**What changed.** `apps/web/features/market/`: `socket/` (`market-socket-client.ts`, `backoff.ts`,
`latency-tracker.ts`, `emitter.ts`, `types.ts`), `api/` (`rest-client.ts`, `queries.ts`,
`query-keys.ts`), `stores/connection-store.ts`.

**Verified.** 272 tests green (58 protocol, 177 api, 37 web), `lint`/`typecheck`/`build` clean.
**Not one web test imports React** — the socket client is driven against a fake socket and fake
timers, which is exactly what T5, T6 and T7 will need.
- Connect: ticket fetched, put in the URL, `CONNECTING → SYNCING → LIVE`.
- A fresh ticket per attempt; a failed ticket fetch is a failed attempt that goes through the
  backoff rather than round it.
- Reconnect reapplies the desired subscriptions and the per-symbol interval, and emits `resync` so
  the book and history are rebuilt.
- An override is reapplied **only** if the user explicitly chose one, and clearing it survives a
  reconnect — a reconnect must not resurrect an override the user already cleared.
- Close codes: `4401`/`4408` fetch a new ticket; `4429` waits out the backoff (asserted by *not*
  reconnecting at 50 ms); `4409` emits `resync: backpressure`; `4000` reconnects normally.
- Backoff ladder, jitter spread and the stability reset all asserted; `ERROR` surfaces after the
  ceiling is hit repeatedly and retries continue.
- Latency: ping every 2 s, RTT measured as a duration, EWMA at α = 0.2, `network.report` every 5 s
  carrying the sample count, and **no report at all** when nothing new was measured.
- Teardown: `disconnect()` leaves zero pending timers and no socket, and a late close afterwards
  does not start a reconnect.

**Design decisions worth knowing.**
- **Every clock and timer is injectable.** `performance.now` and the real timers are only defaults;
  tests supply their own, so no socket test depends on machine speed.
- **The ticket has no accessor.** It exists as a local inside one connect attempt and reaches only
  the URL — there is nowhere for it to be cached from.
- **`AUTHENTICATING` is not a state**, per `docs/04 §3`; the ticket fetch is the first step of
  `CONNECTING`.
- **`LatencyTracker.takeReport()` returns `null` when nothing was measured.** Reporting a stale
  number would tell the server the link is fine precisely when it has gone quiet.
- **Zustand holds only the chrome.** Per-packet market data never passes through it; the domain
  models publish a snapshot once per frame (P10).
- Backoff jitter (`±20%`), the stability window (`= BACKOFF_MAX_MS`) and the `ERROR` threshold
  (`steps + 3`) were not in the docs; they are derived from the ladder and now recorded in
  `docs/04 §11`.

**Still open.**
- `markSynchronized()` / `markSyncing()` are the seam the P8 synchronisers drive.
- Visibility handling (`docs/04 §12`) needs the DOM and lands with the React layer in P10/P11;
  `sendPing()` is already public for the immediate probe on wake.

### P8 — Order-book synchroniser (complete)

**What changed.** `apps/web/features/market/orderbook/`: `order-book-model.ts` (the local mirror,
`bigint` fixed-point, cumulative depth) and `synchronizer.ts` (`OrderBookSynchronizer` plus an
`OrderBookRegistry` that holds one per symbol).

**Verified.** 291 tests green (58 protocol, 177 api, 56 web), `lint`/`typecheck`/`build` clean.

**T2** — the documented worked example runs literally: buffer `98, 99, 101, 102, 103`, snapshot at
`100`, discard `98`/`99`, apply the rest, land at `103`. Then the T2 gap case: local at `102`, a
delta claiming `previousSequence 104` → `resync-required`, `RESYNCING`, sequence untouched at `102`,
book still on screen. The extra cases are covered too: duplicate delta, out-of-order arrival, a hole
inside the buffer, quantity `0` deleting a level, an empty snapshot, a foreign symbol, a superseded
snapshot, and cumulative depth from the touch outward.

**T4** — five fast-check properties over generated books and delta chains:
- Any contiguous chain applied in order reproduces the authoritative book exactly.
- So does the same chain buffered first, delivered **reversed**, with duplicates mixed in.
- Deltas at or below the snapshot sequence are discarded, never replayed.
- A gap **always** resynchronises: the delta after a hole is refused, and the local sequence is left
  exactly where it was rather than half-patched.
- A fresh snapshot recovers cleanly from any gap.

**Per-symbol isolation** is asserted directly: three symbols synchronised, a gap injected into
`ETH-USD` only, and `BTC-USD` / `SOL-USD` stay `SYNCHRONIZED` and keep applying deltas through it.

**A defect the property test found.** The live path already ignored duplicate deltas, but the
buffer-drain path did not — a redelivered delta inside the buffer was mistaken for a hole and forced
a spurious resync. fast-check shrank it to a one-batch, one-duplicate counterexample on the first
run. The drain now applies the same duplicate rule as the live path.

**Design decisions worth knowing.**
- **Buffering starts before the snapshot is requested**, and `beginSync()` returns a **generation**
  the caller hands back with the snapshot. A snapshot from a superseded attempt is dropped rather
  than merged — the same guard the symbol-switch race needs in P9.
- **The previous book stays visible through a resync.** `beginSync()` reports `RESYNCING` rather
  than `SYNCING` when a book is already on screen, so the UI can mark it without blanking.
- The buffer is bounded (2,000 deltas) so a stuck snapshot fetch cannot grow it without limit.
- The registry routes each delta to its own symbol's synchroniser and nowhere else; `route()`
  returns `ignored-symbol` for a symbol nothing is tracking.

**Still open.** Nothing. P9 wires this into the chart and the symbol-switch race.

### P9 — Chart (complete)

**What changed.** Added Lightweight Charts 5.2 and a React-free chart pipeline under
`apps/web/features/market/chart/`: the imperative adapter owns the chart, series, crosshair, price
format, resize and disposal handles; the history controller buffers live candles during REST
fetches, merges by `(symbol, interval, startTime)`, and applies only the higher numeric
`lastTradeId`; the selection controller coordinates subscribe-before-unsubscribe, per-symbol book
sync, interval changes, and late-response rejection. Candle query options now expose the existing
symbol+interval key and TanStack Query `AbortSignal` path; the browser composition root joins that
source to the socket, book registry, real adapter, and teardown callbacks for P10 to mount.

**Verified.** 300 tests green (58 protocol, 177 api, 65 web), `lint`/`typecheck`/`build` clean.
- **T5:** delayed `1m`, then `5s`; the old signal aborts, the late `1m` response is ignored, and the
  adapter receives only `5s` data.
- **T6:** delayed `SOL-USD`, then `HYPE-USD`; HYPE snapshot/history win, SOL cannot mutate chart or
  book, subscribe HYPE occurs before unsubscribe SOL, and exactly one subscription remains.
- Live candle batches are buffered during history, sorted, deduplicated with numeric ids, then sent
  through `series.update()` without React state. Empty history is valid `setData([])`.
- An adapter test proves tick precision (`0.1000` → 1 decimal), chart-boundary number conversion,
  crosshair/hover data, historical updates, resize, and idempotent disposal.
- Failed replacement history resumes the still-visible active chart instead of buffering forever;
  a failed replacement snapshot cannot leak the previous symbol subscription.

**Still open.** P10 mounts the adapter in the terminal UI and adds the debounced `ResizeObserver`.

### P10 — UI + debug panel (complete)

**What changed.** Replaced the placeholder with a live industrial signal-room terminal. A
React-free runtime composes REST, WebSocket, book synchronisation and chart selection; market data
mutates immediately but immutable React snapshots publish at most once per animation frame. Added
registry-driven watchlist reordering, session-labelled price change, 50-trade tape, cumulative-depth
book, four-state delivery override panel, rolling actual cadence, empty states and responsive
desktop/tablet/mobile layouts. The chart now owns a frame-debounced `ResizeObserver` and cancels it
on disposal.

**Verified.** 319 tests green (58 protocol, 177 api, 84 web), `lint`/`typecheck`/`build` clean.
Focused tests prove numeric per-symbol trade ordering and cap, rAF coalescing/cancellation, rolling
rates, guarded watchlist persistence/reconciliation, and resize observer debounce/disposal. Live
API/browser checks at 1280, 768 and 375 px showed 12 asks + 12 bids, a rendered chart, LIVE status,
and `scrollWidth === clientWidth`; symbol and interval switches succeeded. Keyboard reordering did
not change the selected market and survived a reload.

**Review fixes.** Loaded history now clears the waiting overlay without waiting for the next live
candle. A one-second debug refresh ages actual Hz to zero after traffic stops. UI CSS is split below
the ~300-line module limit. Session change semantics are recorded in `docs/04-frontend.md` rather
than implying unavailable 24-hour data.

**Still open.** P11 owns reconnect/resync recovery, visibility handling and the exhaustive failure
and resource-teardown matrix.

### P11 — Failure handling (complete)

**What changed.** Reconnect and sequence-gap recovery now rebuild selected-symbol history and book
without changing subscriptions or blanking the last known view. Hidden tabs keep ingesting data but
pause chart and React publications; wake sends an immediate ping and a hide over 30 seconds performs
a hard refresh. Ticket requests are abortable, stale socket callbacks are detached, and disconnect
renders a monotonic-age `STALE` banner over preserved market data.

**Verified.** 336 tests green (58 protocol, 177 api, 101 web), with dedicated cases for every P11
failure. The teardown matrix proves zero timers/listeners/subscriptions/books after 50 symbol
switches, a visibility cycle, disconnect and disposal. `lint`, `typecheck`, and `build` are clean.
Live API termination preserved 24 book rows, 50 trades and 7 candles behind
`RECONNECTING… LAST LIVE UPDATE 8.1S AGO`; restarting the API returned `LIVE` with a synchronized
24-row book and no browser warnings/errors.

**Still open.** Nothing. All failure recovery flows verified.

### P12 — E2E, deploy, README, recording (reopened for EC2)

**What changed.**
1. **Playwright E2E recovery suite** (`apps/web/e2e/recovery.spec.ts` + `playwright.config.ts`):
   - Dropped book delta sequence gap injection: verifies instant transition from `LIVE` → `RESYNCING` with warning banner, background snapshot resync, and contiguous replay back to `LIVE`.
   - Network disconnect recovery: verifies `context.setOffline(true)` gracefully triggers `STALE (LAST UPDATE X.XS AGO)` without blanking market data, and `setOffline(false)` restores `LIVE` status automatically.
   - Watchlist reordering & market isolation: verifies custom drag/keyboard order does not leak data or disrupt active subscriptions across symbol switches.
   - Responsive layout verification: asserts $\ge 10$ bids and $\ge 10$ asks visible with zero horizontal overflow across 1280px (desktop), 768px (tablet), and 375px (mobile).
2. **Production Docker & deployment orchestration**:
   - Multi-stage `Dockerfile` targeting Node 24 slim, unprivileged `node` user, standalone Next.js + Fastify outputs, and native curl-free `/healthz` check.
   - `docker-compose.yml` for unified local full-stack boot with service health dependencies.
   - `deploy/ec2/` for one persistent EC2 backend, Caddy TLS, ECR images, SSM deployment, and health-checked rollback.
3. **Structured observability**:
   - Prometheus metrics at `GET /metrics` (`ws_reconnects`, `book_resyncs{symbol}`, `ws_connections_total`, `tier_transitions_total`).
   - Structured JSON logs via Pino tracking `ws.reconnected`, `ws.close_resync`, and `rate_limit.strike`.
4. **CI/CD workflows**:
   - `.github/workflows/pr.yml`: Installs Playwright Chromium and executes `pnpm test:e2e` alongside lint, typecheck, unit tests, and build.
   - `.github/workflows/main.yml`: Full main-branch deployment pipeline with Docker build and deployment gates.
5. **Reviewer-ready documentation**:
   - Replaced scaffold `README.md` with complete architecture diagrams, invariant proofs (I1, I2, I3), ADR 0008 App Router justification, state management separation, complete "Packages used" table, deterministic market domain specs, adaptive delivery protocols, local dev instructions, and failure recovery details.

**Verified.**
- `pnpm lint` and Prettier format: clean across all packages.
- `pnpm typecheck`: clean across all packages (zero errors).
- `pnpm test`: 338 passing unit and property tests (58 protocol, 179 api, 101 web).
- `pnpm test:e2e`: 4 passing Playwright recovery flows in 3.8s.
- `pnpm build`: FULL TURBO build cache hit across `@repo/protocol`, `@repo/api`, and `@repo/web`.
- Repo is public with clean git commit history.

**Still open.** Configure AWS/Vercel production values, run the new main workflow, verify the live
HTTPS/WSS services, and upload/link the demo recording.

### P12 EC2 migration review

**Changed.** Removed Fly.io, added ECR → OIDC → SSM → one x86_64 EC2 host with Caddy HTTPS/WSS,
versioned release bundles, `/readyz` gating, two-phase external verification, ticketed WebSocket
smoke, and rollback of image, env, Compose, and Caddy configuration. Added Vercel production deploy
validation and disabled duplicate native Git deployment in `apps/web/vercel.json`.

**Verified.** `pnpm lint`, `pnpm typecheck`, `pnpm test` (338), `pnpm build`, `pnpm test:e2e` (4),
Docker API build, non-root container readiness/health, local ticketed WebSocket smoke, shell syntax,
workflow YAML parsing, and `git diff --check` all pass.

**Risks / follow-ups.** No AWS account, EC2 instance, DNS, GitHub production environment, or Vercel
project was available in this workspace, so live deployment and the recording remain unverified.

## README submission coverage

### Plan

- [x] Add a direct repository link.
- [x] Document REST routes and WebSocket frame types.
- [x] Document the debug drawer and tier overrides.

### Verification

- [x] Run Prettier and `git diff --check`.
- [x] Check links, headings, routes, and frame names against protocol docs.

### Review

#### Changed

Added a direct repository link, a compact REST/WebSocket protocol reference, and debug-control
semantics to `README.md`.

#### Verified

Prettier and `git diff --check` pass. Route and frame names match `docs/01-protocol.md`; the local
protocol-doc link resolves.

#### Risks

None. Documentation-only change.

#### Follow-ups

Record and link the demo video separately.

## Mobile header and ticker synchronization

### Plan

- [x] Reproduce the mobile header overflow and ticker-switch state race.
- [x] Move mobile connection metrics into an accessible hamburger menu.
- [x] Fix synchronizer removal ordering so completed ticker switches return to `LIVE`.
- [x] Add regression coverage for the header and state transition.

### Verification

- [x] Run focused web tests, lint, typecheck, and build.
- [x] Verify 375px/660px layouts and repeated ticker switches in a browser.
- [x] Inspect the final diff and preserve unrelated changes.

### Review

#### Changed

Collapsed sub-1024px connection metrics into a 44px hamburger menu. Removed dead symbol
synchronizers before resetting them so callbacks evaluate the remaining registry and restore
`LIVE` after ticker switches. Added unit, component, and E2E regressions.

#### Verified

`pnpm lint`, `pnpm typecheck`, `pnpm test` (343 tests), `pnpm build`, and `pnpm test:e2e` (5 tests)
pass. Manual Chromium checks at 375px and 660px showed zero horizontal overflow; five consecutive
ticker switches at each width returned to `LIVE / SYNCHRONIZED` in 58–162ms.

#### Risks

None known. The mobile menu overlays content intentionally and leaves the market/price row fixed.

#### Follow-ups

Deploy the frontend and API changes before re-recording the demo.
