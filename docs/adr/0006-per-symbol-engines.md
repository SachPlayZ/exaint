# ADR 0006 — Five symbols, five fully independent engines

- **Status:** Accepted
- **Date:** 2026-09-20
- **Supersedes:** the single-symbol assumption in the original design

## Context

The terminal serves five markets: `BTC-USD`, `ETH-USD`, `SOL-USD`, `HYPE-USD`, `ZEC-USD`.

The protocol always carried `symbol` as a path parameter and a frame field, so multi-symbol was not
a protocol change. The real question was the engine: one simulator emitting tagged events for five
markets, or five self-contained engines.

A shared engine is tempting because it looks like less code. It also means one `tradeId` counter and
one `bookSequence` shared across markets — and at that point a gap in `SOL-USD` is indistinguishable
from normal interleaving in `BTC-USD`, which quietly destroys I1.

## Decision

`SymbolRegistry` owns five `SymbolEngine`s. Each holds its own PRNG stream, order book,
`bookSequence`, `tradeId` counter, and three candle aggregators. Nothing is shared except the single
logical clock, which advances all five in registry order.

Seeds are derived, not independent:

```text
symbolSeed = splitmix64(MARKET_SEED ⊕ fnv1a(symbol))
```

One `MARKET_SEED` still reproduces the entire five-symbol universe. Streams stay independent, so
changing `ETH-USD`'s generator cannot perturb `BTC-USD`'s replay.

Per-symbol config gives each market a distinct character — tick size, base price, trade-size
distribution, volatility, book depth behaviour
([`../02-market-domain.md §2`](../02-market-domain.md#2-symbol-registry)). Price scale `4` and
quantity scale `8` stay uniform so there is one codec.

## Consequences

**Good**

- I1, I2 and I3 scope cleanly to a symbol. A gap in one market resyncs one book.
- Determinism tests stay stable as the simulator evolves, because streams cannot cross-contaminate.
- Five visibly different markets make the demo much stronger than one market rendered five times.
- The client is symmetric: one `OrderBookSynchronizer` per symbol, no special cases.

**Costs, accepted**

- 5× the in-memory state and 5× the tick work. At 25 levels and a 50 ms tick this is negligible.
- Every counter, log line, and metric needs a `symbol` label. Worth it — a global `trades_generated`
  tells you nothing about which engine stalled.
- One more race on the client: the symbol-switch snapshot race, which is the interval-switch race
  with a book attached. Guarded the same four ways and covered by test T6.

## Alternatives rejected

- **One engine, tagged events** — shared sequences break gap detection. Non-starter.
- **One process per symbol** — five markets do not justify five processes, and it would make the
  single-authoritative-instance story worse rather than better
  ([`0004-no-redis-nats.md`](./0004-no-redis-nats.md)).
- **Independent random seeds per symbol** — loses single-seed reproducibility of the whole universe
  for no gain.

## Related

[`../02-market-domain.md §2`](../02-market-domain.md#2-symbol-registry),
[`../04-frontend.md §6`](../04-frontend.md#6-symbol-switching),
[`../07-invariants.md`](../07-invariants.md).
