# ADR 0002 — Fixed-point `bigint` for all money and quantities

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

Prices and quantities are accumulated — candle volume sums thousands of trades, book levels are
added to and consumed repeatedly. JavaScript `number` is IEEE-754 double; repeated `+=` drifts.

Drift here is not cosmetic. It breaks I2: if volume accumulates with a float, two clients whose
updates arrive in different batches can end up with different final volumes, and the candle
invariance test fails intermittently — the worst kind of failure to debug.

## Decision

Represent every domain money/quantity value as a fixed-point integer in `bigint`.

```text
price scale    = 4
quantity scale = 8
```

```text
67231.4287 USD  →  672314287n
0.03124500 BTC  →  3124500n
```

Two conversion boundaries, and only two:

1. **JSON** — decimal strings (`"67231.4287"`, `"0.03124500"`, `"934821"`). JSON cannot encode
   `bigint`. Quantity strings keep trailing zeros; the scale is part of the contract.
2. **Chart** — price converted to `number`, because Lightweight Charts requires numeric values.
   That converted value is display output and is never fed back into a calculation.

## Consequences

**Good**

- Exact arithmetic. Volume over 10,000 trades is exact, so T3 is a real assertion rather than an
  approximate one.
- The serialisation boundary is explicit and testable, instead of being implicit and occasionally
  wrong.

**Costs, accepted**

- More ceremony: no `*` with a plain number, no `Math.max`, scale-aware comparison helpers needed.
- A `bigint` leaking into `JSON.stringify` is a runtime `TypeError`. Mitigated by putting all
  encoding in `packages/protocol` and testing every message type through the serializer.

## Alternatives rejected

- **`number` with rounding at the edges** — the drift is in the accumulation, not at the edges.
- **decimal.js / big.js** — a dependency, slower, and unnecessary when the scales are fixed and
  known. `bigint` is native.

## Related

[02 §4](../02-market-domain.md#5-numeric-precision), [01 §2](../01-protocol.md#3-value-encoding).
