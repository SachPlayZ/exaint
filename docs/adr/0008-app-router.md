# ADR 0008 — App Router, with a deliberately thin server layer

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

Next.js is required, and the router choice must be explained. App Router and Pages Router are both
viable for a single-screen application.

The interesting question is not which router. It is how much of this app should render on the
server — and the honest answer for a realtime terminal is: almost none of it. Every pixel that
matters is driven by a WebSocket that only exists in the browser.

## Decision

**App Router**, structured so the server does as little as possible:

```text
app/page.tsx                  Server Component shell — layout, metadata, nothing live
        │
        ▼
<TradingTerminal />           "use client" — everything below here
```

Everything touching WebSockets, the chart, timers, or browser lifecycle lives below that single
boundary.

**Server Components are not used for market data.** No streaming a snapshot from the server, no
server-side candle prefetch. Doing so would produce a second data path with different freshness
guarantees than the WebSocket, and then the two would have to be reconciled — a whole class of bug
in exchange for a marginally faster first paint on a screen that is stale a hundred milliseconds
later anyway. The client fetches its own snapshot and history, exactly as it does after every
reconnect, so the bootstrap path and the recovery path are the *same code*.

## Why App Router over Pages Router

- It is the router Next.js documents as current and builds new React features against. Choosing the
  older one for a greenfield project needs a reason, and there isn't one here.
- Layout/metadata conventions are cleaner for the shell we do want on the server.
- The client boundary is explicit and reviewable: one `"use client"` directive marks exactly where
  the realtime app begins. In Pages Router the same separation is a convention, not a marker.

Pages Router would work fine. This is not a load-bearing decision, and saying so is better than
inventing a justification.

## Consequences

**Good**

- One data path. Bootstrap and reconnect are identical, so recovery is exercised on every page load.
- The `"use client"` boundary documents the architecture at a glance.
- No hydration mismatch risk from server-rendered prices that are already wrong by the time they
  arrive.

**Costs, accepted**

- Effectively no SSR benefit. For a trading terminal behind a connection handshake, there is nothing
  meaningful to server-render.
- Slightly larger client bundle than a server-heavy design would produce. Irrelevant at this size.

## Related

[`../00-architecture.md §5`](../00-architecture.md#5-deployment-topology),
[`../04-frontend.md §1`](../04-frontend.md#1-app-router-shell).
