# ADR 0005 — Sequence-based order-book sync, with resync as the only recovery

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

A client holding a local order book built from incremental updates can lose one. WebSockets do not
lose messages the way UDP does, but a connection can close mid-stream, a backgrounded tab can be
suspended, and a server under backpressure may have to choose what to do with a backlog.

The local book must therefore be able to answer one question at all times: *is what I am showing
actually correct?*

Timestamps cannot answer it. Two deltas can share a millisecond, clocks adjust, and arrival order
is not causal order.

## Decision

Carry an independent monotonic `bookSequence`, incremented by exactly 1 per emitted delta. Every
delta carries **both** `previousSequence` and `sequence`.

The client applies a delta **only** when:

```text
delta.previousSequence === localBook.sequence
```

Anything else — gap, duplicate, reorder — means the local book is of unknown correctness. The only
recovery is:

```text
bookStatus = RESYNCING
→ re-buffer deltas
→ fetch a fresh snapshot
→ discard buffered deltas <= snapshot.sequence
→ replay the contiguous chain
```

No patching, no interpolation, no requesting individual missing deltas.

Server-side corollary: book deltas are **never** dropped under backpressure. If a client's outbound
book stream is unrecoverably backlogged, the socket is **closed** — the client reconnects and takes
a clean snapshot. Correctness beats pretending the connection is alive.

## Consequences

**Good**

- Gap detection is local, immediate, and free — one integer comparison, no timers, no heuristics.
- Recovery is one code path, exercised constantly, therefore actually reliable. A rarely-run repair
  path would be the buggiest code in the repo.
- Makes I1 a mechanical property, testable with `fast-check` (T4).

**Costs, accepted**

- A single lost delta costs a full snapshot refetch. At this book size that is cheap, and the UI
  stays visible-but-marked throughout, so the user sees honesty rather than a blank panel.
- `previousSequence` is redundant with `sequence - 1` on the wire. Kept anyway: it makes the client
  check explicit and survives any future change to increment semantics.

## Alternatives rejected

- **Timestamp ordering** — not identity, not causal, not reliable. See
  [07 I3](../07-invariants.md#i3--event-ordering).
- **Requesting individual missing deltas** — a second recovery protocol, rarely exercised, and
  therefore the least trustworthy code in the system.
- **Periodic snapshot polling** — wasteful, and it masks gaps instead of detecting them.

## Related

[02 §6](../02-market-domain.md#7-order-book-sequencing), [04 §4](../04-frontend.md#5-order-book-synchronisation),
[07 I1](../07-invariants.md#i1--order-book-continuity).
