# AGENTS.md — Operating Rules

> Read this file **before** touching any code in this repo. It is short on purpose.
> Everything else lives in [`docs/`](./docs/) and is loaded on demand.

---

## 1. What this project is

**Adaptive Crypto Trading Terminal.** A small production-grade trading system:

- A **deterministic synthetic market engine** (seeded PRNG + logical clock) running five
  independent markets — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — each producing
  trades, a live order book, and OHLCV candles.
- A **Fastify WebSocket gateway** that delivers that canonical market data to each browser client at
  a **per-connection frequency tier** (Full / Degraded / Minimal) chosen from measured RTT + jitter.
- A **Next.js trading terminal** that renders chart, order book, and recent trades, survives packet
  loss and disconnects, and never lies about staleness.

It is **not** a toy. The hiring signal is the set of invariants we can defend — see §3.

**Current phase → [`PLAN.md`](./PLAN.md).** Always check the phase before starting work.

---

## 2. Doc routing table

Do not read all the docs. Read the row that matches your task.

| Your task | Read these, in order |
| --- | --- |
| Anything at all | `AGENTS.md` (this file) + [`docs/07-invariants.md`](./docs/07-invariants.md) |
| Understand the system / onboard | [`docs/00-architecture.md`](./docs/00-architecture.md) |
| Add or change a wire message | [`docs/01-protocol.md`](./docs/01-protocol.md) |
| Auth tickets, rate limiting, close codes | [`docs/01-protocol.md §7–8`](./docs/01-protocol.md#7-authentication) |
| PRNG, clock, simulator, order book, candles, fixed-point math | [`docs/02-market-domain.md`](./docs/02-market-domain.md) |
| RTT, jitter, tiers, hysteresis, scheduler, backpressure, override | [`docs/03-adaptive-delivery.md`](./docs/03-adaptive-delivery.md) |
| Any `apps/web` work — socket client, book sync, chart, stores, UI | [`docs/04-frontend.md`](./docs/04-frontend.md) |
| Writing or fixing tests, CI | [`docs/05-testing.md`](./docs/05-testing.md) |
| Docker, deploy, env vars, metrics, logs | [`docs/06-ops-deploy.md`](./docs/06-ops-deploy.md) |
| Confused by a term | [`docs/08-glossary.md`](./docs/08-glossary.md) |
| "Why was X chosen?" | [`docs/adr/`](./docs/adr/) |

Each doc has an `Audience / Read this when / Depends on` header. Trust it.

---

## 3. Non-negotiable invariants

Full statements + enforcement points: [`docs/07-invariants.md`](./docs/07-invariants.md).
Summary, memorise these:

All three are **scoped per symbol**. No global sequence, no global trade counter.

### I1 — Order book continuity

```text
localBook[symbol].sequence === lastSuccessfullyAppliedDelta[symbol].sequence
```

A delta is applied **only** when `delta.previousSequence === localBook[delta.symbol].sequence`.
Any other case → `RESYNC` of that symbol. Never patch, never guess, never skip.

### I2 — Candle invariance across tiers

```text
FinalCandle(FULL) === FinalCandle(DEGRADED) === FinalCandle(MINIMAL)
```

Tier affects **delivery frequency only** — `candles.update` and `trades.batch` cadence, never book
deltas, never content. There is exactly one canonical candle engine per symbol per interval. Tier is
connection-scoped; delivery schedule is per symbol.

### I3 — Ordering is by identifier, never by timestamp

Authoritative ordering keys: `tradeId`, `bookSequence`, `lastTradeId` — each valid **within one
symbol only**. Timestamps are display data. Arrival order is not order.

> If a change would break I1, I2, or I3 — stop, and raise it. Do not "work around" an invariant.

---

## 4. Forbidden patterns

Each row is a real failure mode. Left column = instant reject in review.

| ❌ Never | ✅ Instead | Where explained |
| --- | --- | --- |
| Redux (or any global store) for everything | TanStack Query for REST, Zustand for realtime, imperative adapter for chart | [04](./docs/04-frontend.md#8-state-management-separation) |
| React state holding every socket packet | Domain model mutated per-packet; UI snapshot published once per `requestAnimationFrame` | [04](./docs/04-frontend.md#10-render-scheduling) |
| `Math.random()` without a seed | Seeded PCG/xorshift PRNG, `MARKET_SEED`, per-symbol derived | [02](./docs/02-market-domain.md#3-deterministic-prng) |
| Floating-point OHLCV accumulation | `bigint` fixed-point, decimal strings on the wire | [02](./docs/02-market-domain.md#5-numeric-precision) |
| `setInterval()` as the market clock | One logical tick counter driving all five engines; wall clock only asks "how many ticks are owed?" | [02](./docs/02-market-domain.md#4-logical-market-clock) |
| Timestamp used as event ordering | `tradeId` / `bookSequence` | [07](./docs/07-invariants.md#i3--event-ordering) |
| Ignoring book sequence gaps | Detect gap → `RESYNCING` → fresh snapshot for that symbol | [02](./docs/02-market-domain.md#7-order-book-sequencing) |
| Polling the order-book snapshot on a timer | Snapshot once, then deltas; snapshot again only on resync | [04](./docs/04-frontend.md#5-order-book-synchronisation) |
| Computing separate candles per tier | One canonical candle engine per symbol, per-connection scheduler | [03](./docs/03-adaptive-delivery.md#1-the-central-rule) |
| A shared `tradeId` or `bookSequence` across symbols | Independent counters per `SymbolEngine` | [adr/0006](./docs/adr/0006-per-symbol-engines.md) |
| Hardcoding the symbol list in the frontend | Drive it from `GET /v1/markets` | [01](./docs/01-protocol.md#2-symbols) |
| Merging a late response without checking `symbol` | Validate `symbol` **and** `interval`, plus generation id | [04](./docs/04-frontend.md#6-symbol-switching) |
| Caching or reusing an auth ticket | Fetch a fresh one per connect attempt, inside the backoff | [04](./docs/04-frontend.md#4-authentication) |
| Storing a ticket in `localStorage` | Keep it in a variable for the length of one connect | [04](./docs/04-frontend.md#4-authentication) |
| Closing a live socket because its ticket expired | The ticket authorises the connect, not the session | [adr/0007](./docs/adr/0007-ws-auth-ticket.md) |
| Killing a connection on one malformed or rate-limited frame | Drop the frame, reply `error`, keep the socket; close only on 3 strikes | [01](./docs/01-protocol.md#8-rate-limiting) |
| Client choosing its own automatic tier | Server owns `autoTier`. Client may only send `debug.tier_override` | [03](./docs/03-adaptive-delivery.md#7-debug-override) |
| Changing tier after a single latency sample | Hysteresis: 3 consecutive bad to demote, 5 consecutive good to promote | [03](./docs/03-adaptive-delivery.md#5-hysteresis) |
| Dropping book deltas under backpressure | Coalesce candles, drop trade batches, **never** drop deltas — close the socket instead | [03](./docs/03-adaptive-delivery.md#9-backpressure) |
| `series.setData()` on every trade | `setData()` for history and switches, `series.update()` for the active candle | [04](./docs/04-frontend.md#9-chart-adapter) |
| Interval or symbol switch without request cancellation | Query key includes both + `AbortSignal` + response validation + generation id | [04](./docs/04-frontend.md#7-interval-switching) |
| Clearing the screen when disconnected | Keep last known data visible, mark it `STALE` with an age | [04](./docs/04-frontend.md#11-disconnect-and-reconnect) |
| Proxying the WebSocket through Next.js | Browser connects directly to `wss://api.…/v1/ws` | [00](./docs/00-architecture.md#5-deployment-topology) |
| A chart library that fetches or streams its own data | Library renders what we hand it; we own fetching, interval switching, candle formation, late responses | [04](./docs/04-frontend.md#9-chart-adapter) |
| A timer, listener, or socket created without its cancellation | Teardown table — cancellation written in the same commit | [04](./docs/04-frontend.md#14-resource-teardown) |
| Treating empty history as an error | `[]` is a valid state: empty chart, no crash, no error toast | [04](./docs/04-frontend.md#empty-and-degenerate-history) |
| Desktop-only layout | Responsive is a requirement — three breakpoints, ≥10 levels per side at every width | [04](./docs/04-frontend.md#responsive-layout) |
| Redis / Kafka / Postgres added to look "production" | Single authoritative in-memory engine; document the scaling path only | [adr/0004](./docs/adr/0004-no-redis-nats.md) |
| Domain code importing Fastify or React | Dependency direction is one-way: transport → application → domain | [00](./docs/00-architecture.md#3-dependency-direction) |
| `any`, non-null `!`, unchecked `as` | Real types; Zod parse at every boundary | §5 below |

---

## 5. Code conventions

- **TypeScript strict everywhere.** `strict: true`, `noUncheckedIndexedAccess: true`. No `any`.
  No `as` casts across a trust boundary — parse instead.
- **Money and quantities are `bigint`** in fixed-point. Price scale `4`, quantity scale `8`,
  uniform across all five symbols — only `tickSize` varies.
  They become decimal **strings** at the JSON boundary and `number` **only** at the chart boundary.
  A converted `number` is never fed back into a calculation.
- **Zod validates every boundary**: inbound WS frames, inbound REST params, outbound REST responses
  in tests. Shared schemas live in `packages/protocol` and are imported as `@repo/protocol` by both
  apps. Neither app imports the other's internals — ever.
- **Dependency direction** (enforced by review, and by an eslint boundary rule once added):

  ```text
  HTTP / WS transport  →  application layer  →  market domain
  ```

  `OrderBook` must not know Fastify exists. `CandleAggregator` must not know React exists.
- **No file over ~300 lines.** A 1,500-line `server.ts` is a defect. Split by the module list in
  [`docs/00-architecture.md`](./docs/00-architecture.md#4-module-inventory).
- **Errors are values at the edge.** A malformed client frame produces
  `{"type":"error","code":"INVALID_MESSAGE"}` — it never throws out of a connection handler and
  never kills the process. Same for rate-limited frames: drop the frame, keep the socket.
- **Never log a ticket value.** Log its `sub` and id. `AUTH_TICKET_SECRET` never leaves the
  environment.
- **Naming matches the protocol.** If the wire says `previousSequence`, the code says
  `previousSequence`. No synonyms, no abbreviations.
- **Comments explain why, not what.** Match the surrounding density.

---

## 6. Definition of Done (phase gate)

A phase in `PLAN.md` may be checked off only when **all** of these hold:

1. `pnpm lint` clean.
2. `pnpm typecheck` clean — zero errors, zero suppressions added.
3. `pnpm test` green, including the phase's named tests from
   [`docs/05-testing.md`](./docs/05-testing.md).
4. `pnpm build` succeeds for every affected workspace.
5. The behaviour was **demonstrated**, not assumed — a test output, a log line, or a screenshot.
   "It should work" is not done.
6. Docs updated if behaviour changed (see §8).
7. `tasks/todo.md` checkboxes updated.

---

## 7. Commands

> Target state. Available from Phase 0 onward; before that they do not exist yet.

```bash
pnpm install          # root, once
pnpm dev              # api + web together
pnpm dev:api          # backend only  → http://localhost:8080
pnpm dev:web          # frontend only → http://localhost:3000
pnpm lint
pnpm typecheck
pnpm test             # Vitest unit + property tests
pnpm test:e2e         # Playwright
pnpm build
```

---

## 8. Subagent protocol

When you are a subagent:

1. **One task, one agent.** Do exactly the task in your prompt. Do not widen scope, do not
   "improve while you're in there", do not refactor unrelated files.
2. **Declare your reading.** Open your report with the docs you actually read. If the routing table
   in §2 pointed you at a doc and you skipped it, say so and why.
3. **Report evidence, not confidence.** Paste the test output / command output that proves the
   Definition of Done. If something failed, say exactly that and show the failure.
4. **Never invent a constant.** Every threshold, interval, and scale in this system is already
   specified in the docs. If you cannot find one, it is an open question — surface it, do not pick.
5. **Never break an invariant to make a test pass.** Raise it instead.
6. **Stay in your layer.** A domain-layer task does not touch `apps/web`. A UI task does not
   change the protocol.

When you are the orchestrating session:

- Offload research, exploration, and parallel analysis to subagents to keep the main context clean.
- Give each subagent the routing-table rows it needs, plus the exact Definition of Done.
- Verify the evidence a subagent returns. Do not take a report at face value.

---

## 9. Git

- Repo: `github.com/SachPlayZ/exaint`, public, `main`.
- **Never add attribution lines to commits or pull requests.** No `Co-Authored-By`, no
  "Generated with" footer. Commit messages are the work, nothing else.
- Commit messages: terse, imperative, scoped — `[p2] per-symbol book sequence`.
- Commit or push only when asked.

---

## 10. Change protocol

The docs are the source of truth, not the code.

- Behaviour change → update the **owning doc** in the same change. A code change that contradicts a
  doc is a bug in one of them; resolve it, do not leave a divergence.
- A decision that a future reader would question → add an ADR in
  [`docs/adr/`](./docs/adr/), numbered sequentially, using the existing template.
- A correction from the user → append the pattern to [`tasks/lessons.md`](./tasks/lessons.md)
  as a rule that prevents recurrence.
- Progress → [`tasks/todo.md`](./tasks/todo.md).
