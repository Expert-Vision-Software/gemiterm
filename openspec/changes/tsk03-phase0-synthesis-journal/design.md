## Context

The phantom-auth bug history spans 3+ sessions, 10+ commits, and 5 regressed fixes. The bug synthesis document (`docs/phantom-bug-synthesis.md`) captures this history but lacked a formal commitment to append new entries on every future failure.

## Goals / Non-Goals

**Goals:**
- Commit to the write-once ledger convention: every new phantom-auth symptom, fix attempt, or regression MUST append a new entry to `docs/phantom-bug-synthesis.md`.
- Provide an entry template so new entries are consistent.

**Non-Goals:**
- No code changes.
- No spec delta.
- No test baseline changes.

## Decisions

### D1. Write-once ledger convention

**Choice:** `docs/phantom-bug-synthesis.md` is a write-once ledger. Past entries are never edited; new entries are appended in chronological order under the Appendix section.

**Rationale:** The 4-cookie discovery was the third time a fix shipped green but regressed. Each time, the knowledge that previous fixes failed was spread across commit messages, PR descriptions, and chat transcripts. A single append-only file is the cheapest form of collective memory.

**Alternatives considered:** GitHub Issues (search-degraded over time), CHANGELOG entries (too high-level for technical detail), ADRs (decision-oriented, not symptom-oriented).

### D2. Entry template

**Choice:** The Appendix includes this template:

```
## YYYY-MM-DD — <one-line summary>
**Discovered by:** <who/what>
**Symptom:** <live repro or test output>
**Root cause:** <with code:line>
**Fix (if any):** <commit hash>
**Verified:** <test count, live>
**Related ledger entry:** <cross-ref to earlier section>
```

**Rationale:** Consistent structure enables automated scanning (e.g., `grep "Discovered by"` to find all post-fix failures).

## Risks / Trade-offs

- **[Risk]** The journal grows unbounded. → **Mitigation:** Each entry is ~10–15 lines; the file is not a log but a ledger of only meaningful events.

## Migration Plan

N/A — the rename, convention header, and appendix were already applied in the prior session's docs commit.

## Open Questions

None.
