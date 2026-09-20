# Adaptive Crypto Trading Terminal

> **Status: pre-build.** This README is a scaffold. Sections marked `TODO` are filled in during
> the phase noted beside them. Build plan: [`PLAN.md`](./PLAN.md). Agent rules:
> [`AGENTS.md`](./AGENTS.md).

A real-time crypto trading terminal backed by deterministic synthetic markets. The server runs five
independent engines — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — each computing one
canonical market (order book, trades, OHLCV candles) and delivering it to every connected client at
a frequency tier chosen from that client's measured round-trip latency and jitter. Tiering changes
**how often** a client is updated, never **what** it is told.

- **Demo** — TODO (P12)
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

See [`docs/06-ops-deploy.md`](./docs/06-ops-deploy.md#2-environment-variables).

## Known limitations

TODO (P12). Seeded from the Open Questions blocks across `docs/` and
[`PLAN.md`](./PLAN.md#open-questions).

## Scaling beyond one backend instance

See [`docs/adr/0004-no-redis-nats.md`](./docs/adr/0004-no-redis-nats.md).
