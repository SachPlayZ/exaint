# 04 — Frontend

| | |
| --- | --- |
| **Audience** | Whoever works in `apps/web` |
| **Read this when** | Socket client, auth, book sync, symbol/interval switching, chart, stores, UI, recovery |
| **Depends on** | [`01-protocol.md`](./01-protocol.md), [`07-invariants.md`](./07-invariants.md) |

---

## 1. App Router shell

Use the App Router. Do not overcomplicate this application with Server Components — there is no
server data-fetching story here that pays for the complexity.

```text
app/page.tsx                  Server Component shell
        │
        ▼
<TradingTerminal />           Client Component
```

Everything touching WebSockets, the chart, or browser lifecycle lives below a `"use client"`
boundary.

**Do not proxy the WebSocket through Next.js.** The browser connects straight to the backend:

```text
browser
 ├── https://terminal.example.com   → Vercel
 ├── https://api.example.com        → backend REST
 └── wss://api.example.com/v1/ws    → backend WS
```

---

## 2. Socket architecture

Do not do this:

```ts
useEffect(() => {
   const ws = ...
}, [])
```

Build a class:

```ts
class MarketSocketClient
```

Responsible for:

```text
ticket acquisition
connect
disconnect
subscribe / unsubscribe
reconnect
ping/pong
message validation
visibility
events
```

Hooks then integrate it into React:

```ts
useMarketConnection()
useOrderBook(symbol)
useRecentTrades(symbol)
useTier()
useSymbols()
```

The point of the separation: the networking logic is unit-testable **without React**. Tests T2, T4,
T5, T6, and T7 all depend on that.

---

## 3. Connection state machine

Do not model this as `isConnected: boolean`.

```text
CONNECTING
SYNCING
LIVE
STALE
RECONNECTING
ERROR
```

Every piece of UI logic gets dramatically cleaner once these are real states. `SYNCING` in
particular is what lets the order book be visible-but-honest during a resync.

`AUTHENTICATING` is deliberately **not** a separate state — the ticket fetch is the first step of
`CONNECTING`, and surfacing it separately would only add a flicker the user cannot act on.

---

## 4. Authentication

The socket requires a short-lived ticket ([`01-protocol.md §7`](./01-protocol.md#7-authentication)).

```text
1. POST /v1/auth/ticket        → { ticket, expiresAt }
2. wss://…/v1/ws?ticket=<t>
3. hello frame                 → connected
```

Rules for the client:

- **Fetch a fresh ticket before every connect attempt**, including every reconnect. Tickets are
  single-use and live `60s`; a cached one is worthless and a retried one is rejected.
- The ticket fetch happens **inside** the backoff delay, not before it. A backend that is down
  fails the ticket fetch too, and that failure must not bypass the backoff.
- Never put the ticket in `localStorage`. It lives in a variable, for the length of one connect.
- On close codes `4401` / `4408`, discard everything and restart the flow from step 1. Do not retry
  the same ticket.
- If the ticket fetch itself fails, that is a failed connect attempt: increment backoff and retry.
  After the backoff ceiling is reached repeatedly, surface `ERROR` — but keep the last known market
  data on screen, marked `STALE` (§11).

Once connected, the ticket is irrelevant. The socket outlives its `exp`; liveness is the
heartbeat's job, not the ticket's.

---

## 5. Order book synchronisation

This is I1, client side. Expect to be asked to explain it at a whiteboard, so write it carefully.

**Everything here is per symbol.** The client holds one synchroniser per subscribed symbol, each
with its own buffer, sequence, and status. A resync on `ETH-USD` does not disturb `BTC-USD`.

### Initial connection

```text
1. Connect WebSocket.
2. Subscribe to book deltas for the symbol.
3. Start buffering incoming deltas.
4. Request REST snapshot.
5. Snapshot arrives at sequence S.
6. Discard buffered deltas where sequence <= S.
7. Find delta whose previousSequence == S.
8. Apply deltas sequentially.
9. Enter SYNCHRONIZED state.
```

Buffering **starts before** the snapshot request. That ordering is not optional — reverse it and
there is a window where deltas are lost with no gap signal.

### Worked example

```text
buffer:

98
99
101
102
103

snapshot.sequence = 100
```

Discard:

```text
98
99
```

Then check:

```text
101.previousSequence === 100 ✓
102.previousSequence === 101 ✓
103.previousSequence === 102 ✓
```

Apply them. Local state is now at sequence `103`.

### Detecting lost messages

```text
current sequence = 521

next delta:

previousSequence = 523
sequence         = 524
```

The gap is immediate and unambiguous.

**Do not try to repair it.** Set:

```text
bookStatus = RESYNCING
```

and restart the snapshot synchronisation process from step 3, **for that symbol only**.

The UI **keeps showing the previous book** — it does not blank — but marks it:

```text
SYNCING
```

or

```text
STALE
```

until the new snapshot has been merged.

### `bookStatus`

```text
IDLE
SYNCING
SYNCHRONIZED
RESYNCING
```

---

## 6. Symbol switching

Switching symbol is the same race as switching interval (§7), with a book attached. Five symbols
are live — `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD` — driven from `GET /v1/markets`,
never hardcoded.

On switch from `A` to `B`:

```text
1. subscribe B      (book + trades + candles, current interval)
2. begin B's book sync  — buffer first, then snapshot
3. fetch B's candle history
4. swap the chart once B's history has landed
5. unsubscribe A
6. drop A's synchroniser, buffer, and trade list
```

Subscribe to `B` **before** unsubscribing `A`. The reverse order leaves a dead panel for a round
trip, and there is no cost to a moment of overlap.

Guard the same four ways as interval switching:

```text
query key includes symbol
AbortSignal cancellation
response.symbol validation
request generation ID
```

And on the realtime side:

```ts
if (message.symbol !== selectedSymbol)
  ignore
```

A late `SOL-USD` snapshot must never be merged into a `HYPE-USD` book. That failure is silent,
produces a plausible-looking book, and is exactly what test T6 exists to catch.

**Do not keep dead symbols subscribed.** The per-connection cap is 5, and a switcher that leaks
subscriptions hits `TOO_MANY_SUBSCRIPTIONS` after a few clicks.

---

## 7. Interval switching

A classic source of bugs. The race:

```text
user selects 1m
GET /candles?interval=1m starts
```

then immediately:

```text
user selects 5s
GET /candles?interval=5s starts
```

but the `1m` request finishes **later** and overwrites the `5s` chart.

Use **all four** defences, not one:

```text
query key includes interval
AbortSignal cancellation
response.interval validation
request generation ID
```

TanStack Query supports query keys containing variables and `AbortSignal`-based cancellation, which
is exactly the shape of this problem.

```ts
queryKey: ['candles', symbol, interval]
```

Generation guard:

```ts
const generation = ++historyGeneration

const result = await fetchHistory(symbol, interval)

if (generation !== historyGeneration)
  return
```

And on the realtime side:

```ts
if (message.symbol !== selectedSymbol)   return
if (message.interval !== selectedInterval) return
```

One generation counter covers both symbol and interval — they are the same race with two inputs.
Test T5 exercises interval, T6 exercises symbol.

---

## 8. State management separation

Three mechanisms, three jobs. Do not collapse them.

### TanStack Query — REST server state

```text
symbol registry
historical candles
order-book snapshot
```

### Zustand — realtime application state

```text
connection state
selected symbol
latest price (per symbol held)
tier
RTT
jitter
recent trades
top-of-book
stale/live status
```

### Imperative chart adapter — not React state at all

Live candlestick updates never enter React state. See §9.

---

## 9. Chart adapter

```text
CandlestickChartAdapter
```

wraps Lightweight Charts and owns every handle it creates.

```ts
series.setData(history)      // history / symbol switch / interval switch
series.update(activeCandle)  // live
```

Lightweight Charts supports candlestick series and incremental updating directly. Do not build
custom DOM candles.

Rules:

- `setData()` on history load, symbol switch, and interval switch only. **Never** per trade.
- `update()` for the active candle.
- Explicit dispose on unmount, on symbol switch, and on interval switch — leaked series are a real
  failure mode, and with five symbols you will notice.
- Price formatting follows the symbol's `tickSize` from the registry — `HYPE-USD` at four decimals
  and `BTC-USD` at four decimals look equally wrong for opposite reasons.
- Chart-boundary `number` conversion happens here and nowhere else, and the result never flows back
  into a calculation ([`02-market-domain.md §5`](./02-market-domain.md#5-numeric-precision)).

### Merging history and realtime

Live candle messages arrive **during** the history fetch. Buffer them.

Once history arrives:

```text
history
   +
buffered live candles
```

Deduplicate by:

```text
symbol + interval + candleStart
```

If two versions of the same candle exist, keep the one with the higher:

```text
lastTradeId
```

`lastTradeId` is only comparable **within a symbol** — that is why `symbol` is part of the dedupe
key, not an assumption.

Then `setData()` once, and transition to ordinary `series.update()`.

### Interaction

```text
crosshair
hover
drag/pan
scroll/zoom
```

Hover readout:

```text
Sep 20 07:31:05

O  67,220.1
H  67,244.9
L  67,219.5
C  67,239.2
V  3.829 BTC
```

---

## 10. Render scheduling

Separate two frequencies that have no reason to be equal:

```text
network correctness frequency
```

from

```text
React rendering frequency
```

The order-book synchroniser processes **every delta immediately** — correctness cannot be
throttled. But React does not need to re-render 50 times a second.

```text
WS → domain state → scheduled UI publication
```

Apply all mutations to the internal model, then publish a UI snapshot through
`requestAnimationFrame`, at most once per browser frame. Scrolling and chart gestures stay
responsive because of this, not by accident.

---

## 11. Disconnect and reconnect

### Never blank the UI

On disconnect:

```text
latest price remains visible
chart remains visible
order book remains visible
recent trades remain visible
```

…but the whole market state becomes visibly:

```text
STALE
```

with something like:

```text
Reconnecting…
Last live update 4.2s ago
```

The age counter keeps ticking. An honest stale UI beats a blank one, and this is specifically what
the assignment asks for.

### Backoff

Exponential with jitter:

```text
250ms
500ms
1s
2s
4s
8s
max 10s
```

Random jitter is added to avoid synchronised reconnect storms across clients. Reset the retry count
after a sufficiently stable connection.

### On reconnect — in this order

```text
1. wait out the backoff delay
2. fetch a fresh auth ticket
3. create new WS with that ticket
4. resubscribe the selected symbol
5. restart RTT measurement
6. rebuild order book from snapshot
7. refresh candle history
8. reapply selected interval
9. reapply debug override if explicitly selected
```

Step 2 is inside the backoff, not before it — see §4. Step 9 reapplies the override **only if the
user explicitly selected one**; a reconnect must not resurrect an override the user already
cleared.

Close code `4429` (rate-limit abuse) means the client is misbehaving. Reconnect, but never
immediately — honour the backoff, and log it loudly in development.

---

## 12. Browser visibility

Handle `document.visibilitychange`.

**When hidden:**

- keep the socket alive
- stop unnecessary chart repaints
- keep maintaining canonical client-side network state
- record the time the page became hidden

**When visible again:**

```text
send immediate latency ping
```

- hidden for under `30s` → resume normally
- hidden for

  ```text
  >30 seconds        (VISIBILITY_HARD_REFRESH_MS = 30000)
  ```

  → **hard refresh** of the selected symbol:

  ```text
  fresh order-book snapshot
  fresh candle history
  ```

Browsers heavily suspend background tabs. Assuming a backgrounded tab processed every message is
how books silently diverge without ever producing a gap signal. The hard refresh is cheaper than
trusting it.

Only the selected symbol is refreshed — nothing else is subscribed.

---

## 13. Screen layout

Desktop:

```text
┌──────────────────────────────────────────────────────┐
│ BTC ETH SOL HYPE ZEC │ $67,231.42 ▲0.32% LIVE 42ms FULL│
├────────────────────────────────────┬─────────────────┤
│                                    │ ORDER BOOK      │
│                                    │                 │
│           CANDLE CHART             │ Asks            │
│                                    │                 │
│        1s   5s   1m                │ Spread          │
│                                    │                 │
│                                    │ Bids            │
├────────────────────────────────────┼─────────────────┤
│ Network / debug info               │ RECENT TRADES   │
└────────────────────────────────────┴─────────────────┘
```

- Symbol switcher is the leftmost header element, driven by `GET /v1/markets`.
- Order book: cumulative depth bars behind the quantities, `25` levels per side.
- Recent trades:

  ```text
  Time        Price        Amount
  07:31:22    67,231.4     0.041
  07:31:21    67,230.9     0.012
  ```

- Buy/sell direction is shown visually, but **not by colour alone** — accessibility.
- Client keeps only the latest `50` trades for the selected symbol.
- Price and quantity formatting come from the symbol's registry entry, not from a constant.

### Debug drawer

Collapsed by default. Include it — it makes the implementation trivially demonstrable.

```text
Connection
─────────────────
Status        LIVE
Connection    f3a8d1...
Symbol        BTC-USD
Last book seq 839122
Last trade ID 312193

Network
─────────────────
RTT           42 ms
Jitter        6 ms

Adaptive delivery
─────────────────
Auto tier     FULL
Override      OFF
Effective     FULL
Candles       10 Hz target / 9.8 Hz actual
Trades         5 Hz target / 4.9 Hz actual

[Auto] [Full] [Degraded] [Minimal]
```

Actual rates are measured client-side over a 5 s rolling window from received frames. Showing
target next to actual is what proves the scheduler works — and with tier-scaled trade cadence,
both rows move when the tier changes.

---

## Open questions

- Mobile / narrow layout: in scope, or desktop-only with a documented limitation?
  *(assumed: responsive enough not to break, desktop-first)*
- Live prices in the symbol switcher need a `ticker` channel
  ([`01-protocol.md` open questions](./01-protocol.md#open-questions)). Deferred; the switcher
  works as plain buttons.
