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
