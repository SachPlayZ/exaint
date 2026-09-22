# tasks/lessons.md

Corrections turned into rules. Append after **any** correction from the user, or after any mistake
that cost real time. Review at session start.

Format — keep each entry short and actionable:

```markdown
## YYYY-MM-DD — <one-line pattern>

**What happened:** <the mistake, factually>
**Rule:** <what to do instead, phrased so it prevents recurrence>
**Applies to:** <docs/files/phases where this bites>
```

A lesson that does not change future behaviour is a diary entry, not a lesson. Write the rule.

---

## 2026-09-20 — No attribution lines in commits or PRs

**What happened:** Default harness guidance adds `Co-Authored-By` / "Generated with" footers. User
said never to include them.
**Rule:** Commit messages and PR bodies end with the work, nothing else. No co-author trailers, no
tool footers, no emoji attribution — in this repo or any other.
**Applies to:** every commit and PR; recorded in [`../AGENTS.md` §9](../AGENTS.md#9-git).

## 2026-09-20 — Check the brief before declaring docs complete

**What happened:** Docs were reported complete, then a pass against the actual assignment found 9
uncovered requirements (empty history, top-10 display, responsive, packages list, router
rationale, teardown, public repo, chart-library constraint, watchlist bonus).
**Rule:** When work is derived from a source brief, run an explicit line-by-line check against that
brief — including its Deliverables and Bonus sections — before calling it done. Internal
consistency is not coverage.
**Applies to:** any doc or implementation traced to a written spec.

## 2026-09-20 — Smoke-test the real output, not just the assertions

**What happened:** P2's order book passed every test — 25 levels a side, uncrossed, correct
sequencing, deterministic replay — and was still wrong. Replenishment only extended outward from
the far edge, so as the fair value moved the touch migrated and the old cluster stayed put: the
book was a lonely best level above a stale block, with gaps of up to 200 grid steps. It surfaced
only when a `curl` against the running API was read with human eyes during P4.
**Rule:** For anything a human will look at, print a real sample and read it before calling the
phase done. Tests assert the properties you thought of; a sample shows the ones you did not. When
the sample looks off, measure the suspicion before theorising — the gap histogram took two minutes
and ended a chain of wrong guesses.
**Applies to:** the market simulator, the order book panel, the chart, anything with a visual
shape. Phase gate [`../AGENTS.md` §6.5](../AGENTS.md#6-definition-of-done-phase-gate) already says
"demonstrated, not assumed" — this is what that means for output a person reads.

## 2026-09-21 — Exercise every visible state in race-prone UI flows

**What happened:** One production ticker switch recovered, but another response ordering left the
book `SYNCHRONIZED` while the header stayed `SYNCING`; the narrow header also only passed overflow
checks without being visually usable.
**Rule:** For switch/recovery UI, test multiple symbols and assert both domain and connection states;
inspect the reported viewport visually, not only `scrollWidth`.
**Applies to:** `apps/web` symbol switching, responsive layout, and E2E coverage.

## 2026-09-22 — Keep README voice product-focused

**What happened:** README described its invariants as a "hiring signal," which made the project sound
like it was seeking validation rather than explaining the system.
**Rule:** Write README copy around the product and its guarantees; omit hiring, interview, or reviewer
framing unless the user explicitly asks for it.
**Applies to:** `README.md` and public-facing project documentation.
