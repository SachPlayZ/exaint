# ADR 0003 — Tiering sits outside the market-data pipeline

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

The requirement is that slow clients get fewer updates. There are two ways to read that, and only
one of them is correct.

**Reading A (wrong).** Each tier gets its own reduced data pipeline — sample the trades, aggregate
from the sample, send the result. Fewer updates because there is less data.

**Reading B (right).** Every client's data is computed identically from 100% of trades. Tier decides
only how often the client is *told* about the current candle.

Reading A is the tempting one because it looks like it saves work. It also silently produces
different candles per tier, which is the single failure the assignment is designed to detect.

## Decision

The market engine processes 100% of trades and computes the full order book and full candle state,
with **no awareness that tiers exist**. Tiering is applied strictly downstream of the internal event
bus, inside each `ConnectionSession`'s delivery scheduler.

```text
Full client       ──────► 10 candle updates/sec
Degraded client   ──────►  2 candle updates/sec
Minimal client    ──────►  0.5 candle updates/sec

                         BUT

Canonical candle ──────► exactly identical for all three.
```

Two rules fall out of this and are non-negotiable:

- **Finalised candles are queued, never dropped.** A Minimal client updated every 2000 ms would
  otherwise never see a `1s` candle that opened and closed between its updates.
- **Active candles coalesce.** Only the newest matters, so a newer version replaces an older one in
  the single active slot.

## Consequences

**Good**

- I2 holds by construction, and T3 can prove it.
- Three tabs at three tiers against one backend show identical values at different cadences — the
  demo writes itself.
- The engine stays simple: no per-client recomputation, no sampling logic, no divergence to debug.

**Costs, accepted**

- The server does full work regardless of tier. At this scale that is free, and it is the correct
  trade even when it is not.
- Per-connection scheduler state (`pendingFinalCandles`, `latestActiveCandle`, `lastCandleSentAt`)
  must be maintained per socket. That is the price of correctness.

## Related

[00 §1](../00-architecture.md#1-system-diagram), [03 §1–2](../03-adaptive-delivery.md#1-the-central-rule),
[07 I2](../07-invariants.md#i2--candle-invariance).
