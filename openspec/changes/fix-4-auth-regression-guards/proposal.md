# Proposal: fix-4-auth-regression-guards

Sequence: fix-4 of 4 — lands AFTER `fix-1-cookie-session-core`, `fix-2-phantom-detection`, and `fix-3-session-keepalive` are implemented and archived. This change touches no production auth code. Evidence base: `docs/auth-cookie-lifecycle.md` (validated wire/facts), `docs/cookie-ablation-findings.md` (empirical study), `docs/phantom-bug-synthesis.md` (the 2-week, multi-million-token cost ledger).

## Why

The phantom-auth saga cost 2+ weeks and millions of tokens not because any single fix was hard, but because (a) every regression was introduced by a *plausible-looking* change to a capture/persist/rotate path that no test exercised, and (b) agents were repeatedly misled by documentation that was stale, contradictory, or later disproven (three ledger entries exist solely because a probe, a filter, or a merge rule "looked right" against the wrong doc). fix-1..3 replace the implementation; nothing yet guarantees the *next* agent cannot reintroduce the disease. This change makes regression structurally hard: a dedicated auth regression gate that must fail loudly on any cookie/auth-touching change, and a single authoritative documentation surface with conflicts pruned.

## What Changes

- **Dedicated auth regression fixture** — new `tests/auth-regression/` suite (own directory, own fixture `tests/auth-regression/fixtures.ts`) pinning the invariants that every prior ledger bug violated. It tests through the `CookieSession` public surface and the on-disk jar contract, never internals:
  - full-jar capture integrity (no name-subset filtering anywhere in the pipeline; the H6/REQUIRED_COOKIES class),
  - PSIDTS value-change propagation through every persist path (store save, refresh runner, recovery rung; the discarded-rotation class),
  - no anonymous-cookie persistence on signed-out captures (the notebooklm #312 / ledger save-on-login-page class),
  - CAS semantics (a stale in-memory jar cannot clobber a fresher disk jar; the #361 class),
  - tier-1/tier-2 validator contract incl. RFC-6265 routability (present-but-unroutable PSIDTS must not pass; the #2061 class),
  - classifier truth table (live/phantom/dead vs init-tokens × listChats),
  - probe honesty (no side effects: no disk write, no rotation on the `probe` path).
- **Gating rule** — an explicit, checked list of "auth-sensitive paths" (`src/auth/**`, `playwright-cli-driver.ts`, `gemini-client-wrapper.ts` cookie plumbing, `profile-lifecycle.ts` login action, any file matching cookie/auth regexes). CI (and a local pre-commit hint) fails when a diff touches an auth-sensitive path without also touching `tests/auth-regression/`. Opt-out requires an explicit `SKIP_AUTH_REGRESSION_GATE=1` with a stated reason in the PR body.
- **Mutation-style canary (cheap form)** — one scripted check that verifies the gate actually detects injected regressions: temporarily re-introduces each historical bug shape (name-filter, PSIDTS-discard, stale-clobber) against the fixture in a sandboxed copy and asserts tests go RED. Run in CI nightly, not per-push.
- **Documentation consolidation** — one authoritative doc chain, conflicts pruned:
  - KEEP authoritative: `docs/auth-cookie-lifecycle.md` (canonical design + validated facts), `docs/cookie-ablation-findings.md` (empirical record), `docs/PLAYWRIGHT_CLI_API.md`.
  - ARCHIVE for reference (move to `docs/archive/`): `docs/phantom-bug-synthesis.md` (write-once ledger — closed once fix-1..3 land; a final entry records the closure), `docs/auth-replacement-plan.md` (superseded by the landed fixes), `docs/refactorings-phase-1.html` + `refactorings-phase-2.html` (consumed; their #1 candidate is fix-1).
  - PRUNE/REDIRECT: stale sections in remaining docs that duplicate or contradict the lifecycle doc get replaced by one-line pointers; a repo-doc index at `docs/README.md` declares the authority order (lifecycle doc > ablation findings > archived history).
- **AGENTS.md hardening** — the agent guide gains: the auth-sensitive path list, the "docs authority order," the rule that any auth/cookie change must run `bun test tests/auth-regression` and update the lifecycle doc's changelog section in the same PR, and the standing traps (static `models()` probe ban, cookie-`expires` meaninglessness, name-filter ban) as non-normative pointers into the lifecycle doc.

## Capabilities

### New Capabilities

- `auth-regression-gate` — the dedicated fixture suite, the auth-sensitive path gating rule, and the mutation canary contract.

### Modified Capabilities

- `testing` — adds the auth-regression fixture registry (shared jar builders: fresh-full, stale-full, phantom-shaped, dead, trimmed-4) alongside the existing `createMockCookies` fixtures, and requires the suite to be isolated from the global test setup so it cannot be satisfied by mocks elsewhere.
- `domain-model` (docs convention) — records the documentation authority order and archive policy so future agents resolve doc conflicts by rule, not judgment.

## Impact

- **Code**: none in `src/` (test-infra and docs only). New: `tests/auth-regression/{fixtures.ts,*.test.ts}`, `scripts/check-auth-gate.(ps1|sh)` (or CI-job form), `.github/workflows/test.yml` step, `docs/README.md`, `docs/archive/`. Modified: `AGENTS.md`, remaining `docs/*` (pointer-pruning only).
- **Tests**: net addition (~40–60 tests). Baseline after fix-3 becomes this change's floor; recorded in tasks at implementation time.
- **Docs**: as listed above; `docs/phantom-bug-synthesis.md` gets its closing entry before the move.
- **Dependencies**: none.
