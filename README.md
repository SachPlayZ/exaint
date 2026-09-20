# Adaptive Crypto Trading Terminal

> **Status: pre-build.** This README is a scaffold. Sections marked `TODO` are filled in during
> the phase noted beside them. Build plan: [`PLAN.md`](./PLAN.md). Agent rules:
> [`AGENTS.md`](./AGENTS.md).

A real-time crypto trading terminal backed by deterministic synthetic markets. The server runs five
independent engines — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — each computing one
canonical market (order book, trades, OHLCV candles) and delivering it to every connected client at
a frequency tier chosen from that client's measured round-trip latency and jitter. Tiering changes
**how often** a client is updated, never **what** it is told.

- **Repo** — <https://github.com/SachPlayZ/exaint> (public)
- **Demo recording** — TODO (P12)
- **Screenshots** — TODO (P12)
- **Live URL** — TODO (P12)

---

## Architecture

See [`docs/00-architecture.md`](./docs/00-architecture.md). Summary diagram copied here in P12.

## Repository structure

See [`docs/00-architecture.md`](./docs/00-architecture.md#2-repository-layout).

## Technology choices

See [`PLAN.md`](./PLAN.md#stack-fixed--see-adrs-before-changing-anything-here) and
[`docs/adr/`](./docs/adr/).

## Router choice — App Router

App Router, with a thin Server Component shell and everything live below one `"use client"`
boundary. Full reasoning, including why Server Components are deliberately *not* used for market
data: [`docs/adr/0008-app-router.md`](./docs/adr/0008-app-router.md).

## Packages used

TODO (P12) — filled from the final lockfile. The table carries, for each package, what it does and
why it is here:

| Package | Role | Why this one |
| --- | --- | --- |
| `next` | App shell, routing, build | Required by the assignment; App Router ([ADR 0008](./docs/adr/0008-app-router.md)) |
| `react` / `react-dom` | UI | Required |
| `fastify` | HTTP + WS server | Small, fast, first-class TS types |
| `@fastify/websocket` / `ws` | WebSocket transport | Native integration with the above |
| `zod` | Runtime protocol validation | One schema is the source of truth for both apps ([`docs/01-protocol.md`](./docs/01-protocol.md#1-ownership)) |
| `@tanstack/react-query` | REST server state | Query keys + `AbortSignal` cancellation solve the switch race ([`docs/04-frontend.md`](./docs/04-frontend.md#7-interval-switching)) |
| `zustand` | Realtime UI state | Low-overhead, no provider tree, selector-level subscriptions |
| `lightweight-charts` | Candlestick rendering **only** | Renderer for data we supply; it never fetches or streams ([`docs/04-frontend.md`](./docs/04-frontend.md#9-chart-adapter)) |
| `tailwindcss` / `shadcn/ui` | Styling, primitives | Fast, responsive, accessible defaults |
| `vitest` | Unit + integration tests | Same toolchain both sides |
| `fast-check` | Property tests | Order-book invariant T4 |
| `@playwright/test` | E2E recovery flows | Can block individual WS messages and emulate offline |
| `turbo` / `pnpm` | Monorepo | Workspace builds and caching |

Anything added beyond this list gets a row and a justification, or it does not get added.

## Symbols

Five markets with distinct character — see
[`docs/02-market-domain.md §2`](./docs/02-market-domain.md#2-symbol-registry) and
[`docs/adr/0006-per-symbol-engines.md`](./docs/adr/0006-per-symbol-engines.md).

## Synthetic market model

See [`docs/02-market-domain.md`](./docs/02-market-domain.md).

## Numeric precision

See [`docs/02-market-domain.md`](./docs/02-market-domain.md#5-numeric-precision).

## REST protocol

See [`docs/01-protocol.md`](./docs/01-protocol.md#4-rest).

## WebSocket protocol

See [`docs/01-protocol.md`](./docs/01-protocol.md#5-websocket).

## Authentication and rate limiting

See [`docs/01-protocol.md §7–8`](./docs/01-protocol.md#7-authentication) and
[`docs/adr/0007-ws-auth-ticket.md`](./docs/adr/0007-ws-auth-ticket.md).

## Order book synchronisation

See [`docs/04-frontend.md`](./docs/04-frontend.md#5-order-book-synchronisation).

## Candle generation

See [`docs/02-market-domain.md`](./docs/02-market-domain.md#8-candle-engine).

## Adaptive delivery

See [`docs/03-adaptive-delivery.md`](./docs/03-adaptive-delivery.md).

- **Latency measurement** — [`§3`](./docs/03-adaptive-delivery.md#3-latency-measurement)
- **Jitter calculation** — [`§4`](./docs/03-adaptive-delivery.md#4-latency-and-jitter-smoothing)
- **Tier thresholds** — [`§5`](./docs/03-adaptive-delivery.md#5-hysteresis)
- **Hysteresis** — [`§5`](./docs/03-adaptive-delivery.md#5-hysteresis)
- **Missing reports** — [`§6`](./docs/03-adaptive-delivery.md#6-missing-reports)
- **Debug overrides** — [`§7`](./docs/03-adaptive-delivery.md#7-debug-override)

## Frontend architecture

See [`docs/04-frontend.md`](./docs/04-frontend.md).

## State management

See [`docs/04-frontend.md`](./docs/04-frontend.md#8-state-management-separation).

## Chart lifecycle

See [`docs/04-frontend.md`](./docs/04-frontend.md#9-chart-adapter).

## Symbol and interval switching

See [`docs/04-frontend.md §6`](./docs/04-frontend.md#6-symbol-switching) and
[`§7`](./docs/04-frontend.md#7-interval-switching).

## Reconnection

See [`docs/04-frontend.md`](./docs/04-frontend.md#11-disconnect-and-reconnect).

## Browser visibility

See [`docs/04-frontend.md`](./docs/04-frontend.md#12-browser-visibility).

## Stale data behaviour

See [`docs/04-frontend.md`](./docs/04-frontend.md#11-disconnect-and-reconnect).

## Backpressure

See [`docs/03-adaptive-delivery.md`](./docs/03-adaptive-delivery.md#9-backpressure).

## Testing

See [`docs/05-testing.md`](./docs/05-testing.md).

## Local development

```bash
pnpm install
pnpm dev          # api + web
pnpm dev:api      # backend only  → http://localhost:8080
pnpm dev:web      # frontend only → http://localhost:3000
pnpm test
pnpm test:e2e
```

> Available from P0 onward.

## Deployment

See [`docs/06-ops-deploy.md`](./docs/06-ops-deploy.md).

## Environment variables

See [`docs/06-ops-deploy.md`](./docs/06-ops-deploy.md#3-environment-variables).

## Bonus features

- **Watchlist reordering** — drag or keyboard reorder, persisted per browser.
  [`docs/04-frontend.md §13`](./docs/04-frontend.md#watchlist)
- **Production-style deployment** — separate frontend and backend services, automated builds,
  environment-based configuration. [`docs/06-ops-deploy.md`](./docs/06-ops-deploy.md)

## Known limitations

TODO (P12). Seeded from the Open Questions blocks across `docs/` and
[`PLAN.md`](./PLAN.md#open-questions).

## Scaling beyond one backend instance

See [`docs/adr/0004-no-redis-nats.md`](./docs/adr/0004-no-redis-nats.md).
