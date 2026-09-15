# Auth-regression gate: same-change coupling, blocking in CI

Three capture-path bugs, a killed-valid-session episode, and a deleted-doctrine incident (commit `67bc148`, caught only by audit) showed that auth regressions arrive as *unrelated-looking* diffs. The gate therefore couples, in one change: (1) any diff touching an auth-sensitive path (`AUTH_SENSITIVE_PATHS`: the cookie session surface, the playwright-cli driver's sensitive methods, the rotation engine) must also touch `tests/auth-regression/`; (2) auth behavior changes must append to the lifecycle doc's changelog; (3) `check:auth-gate` blocks in CI (flipped from warn-only at `5f08eae`), with a nightly mutation canary on a clean worktree.

## Consequences

- `SKIP_AUTH_REGRESSION_GATE=1` exists but every use is audited and needs a stated reason.
- A docs-only change must never delete the sensitive-area doctrine (AGENTS.md hazard section) — that exact deletion happened once and is the reason this ADR exists.
