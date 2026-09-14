# Documentation Index — Authority Order

Any conflict between documents is resolved **by rule, not judgment**:

1. **`docs/auth-cookie-lifecycle.md`** — canonical and normative. The validated design and wire facts for auth. If any other document disagrees with this one on an auth fact, the lifecycle doc governs.
2. **`docs/cookie-ablation-findings.md`** — the empirical record (what was actually probed, when, with what outcome). Feeds (1); never overrides it.
3. **Everything else** (including this index, `README.md`, `AGENTS.md`, OpenSpec archives) — must not contradict (1). Where a conflict is found, prune to a pointer to (1).

## Current documents

| Document | Role |
|---|---|
| `auth-cookie-lifecycle.md` | Canonical auth design + validated facts + changelog. **Any auth-behavior change must update its changelog in the same PR** (enforced by the auth-regression gate). |
| `cookie-ablation-findings.md` | Empirical cookie-ablation study; source of the `tests/auth-regression/` jar-shape fixtures. |
| `PLAYWRIGHT_CLI_API.md` | Upstream API reference for the `@playwright/cli` subprocess. |
| `INSTALL.md` | Installation instructions. |
| `re-implement-through-v2-7-2.md` | Historical rewrite log; non-auth. Any auth statement in it that contradicts (1) is void — the lifecycle doc governs. |

## Auth changes: the same-PR rule

Any change touching an auth-sensitive path must, **in the same change**:

1. add or update tests under `tests/auth-regression/` (the gate `bun run check:auth-gate` enforces this — warn-only in CI during rollout, flipping to blocking per fix-4 task 3.4), and
2. append a changelog entry to `docs/auth-cookie-lifecycle.md`.

Standing traps (static-`models()` probe ban, cookie-`expires` meaninglessness, name-filter ban) are documented in the lifecycle doc — see its relevant sections rather than relying on memory or superseded conclusions.
