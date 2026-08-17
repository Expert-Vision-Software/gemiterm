# Tasks: fix-4-auth-regression-guards

Prerequisite: fix-1, fix-2, fix-3 implemented and archived. Baseline test counts are recorded at implementation time (this change is additive-only to `src/`).

## 1. Fixtures and suite scaffolding

- [x] 1.1 Create `tests/auth-regression/fixtures.ts` with the five jar builders (`freshFullJar`, `staleFullJar`, `phantomShapedJar`, `deadJar`, `trimmedFourCookieJar`), shapes derived from `docs/cookie-ablation-findings.md`, plus a per-file isolated `GEMITERM_CONFIG_DIR` bootstrap (no imports from the global mock-cookie fixtures)
- [x] 1.2 Create the fake seams: driver fake (state-save output, page outcomes) and wire fake (init-token/listChats behavior per jar shape), injected through the existing DI surfaces

## 2. Invariant tests (one per historical bug class)

- [x] 2.1 Full-jar capture integrity: capture persists every offered cookie; RED if any name-subset filter reappears (H6 / `REQUIRED_COOKIES` class)
- [x] 2.2 Rotation propagation: PSIDTS value-change lands on disk via store save, detached refresh runner, and recovery rung; RED if any path discards the new value (discarded-rotation class)
- [x] 2.3 Signed-out capture safety: no write, no overwrite of an existing jar on anonymous-cookie captures (save-on-login-page class)
- [x] 2.4 CAS semantics: stale in-memory jar cannot clobber fresher disk PSIDTS (#361 class)
- [x] 2.5 Validator contract: tier-1 raises on absent `__Secure-1PSID` or non-routable PSIDTS (expired / wrong-scope); tier-2 warns once on missing companions (#2061 class)
- [x] 2.6 Classifier truth table: live / phantom / dead across jar shapes, deterministic on repeat
- [x] 2.7 Probe purity: read-only classifier writes nothing and fires no rotation (byte-identical jar before/after)
- [x] 2.8 Run `bun test tests/auth-regression` green; record net test-count delta vs pre-change baseline in this file
  - Baseline before this change: 917 pass / 0 fail. After: 937 pass / 0 fail under `bun test --isolate` (2 pre-existing skips) — net +20, all from `tests/auth-regression/` (4 files: capture-integrity 6, cas-semantics 2, validator-contract 5, classifier-truth-table 7).
  - Implementation note: unblocked by fixing `writeFileExclusive` in `src/infrastructure/io.ts` (missing `ensureDir` on the lock-file parent — ENOENT when capturing into a fresh profile dir).

## 3. Gate mechanics

- [x] 3.1 Author `AUTH_SENSITIVE_PATHS` list (paths + content regex incl. `docs/auth-cookie-lifecycle.md`) with a reviewed benign-allowlist file
  - List: `AUTH_SENSITIVE_PATHS` (doc form) + `PATH_SPECS` in `scripts/check-auth-gate.{sh,ps1}` (executable form); allowlist: `scripts/auth-gate-allowlist`.
- [x] 3.2 Implement `scripts/check-auth-gate` (bash + pwsh parity, diff-driven with merge-base fallback, `SKIP_AUTH_REGRESSION_GATE=1` opt-out requiring a stated reason) and wire `bun run check:auth-gate`
  - Also supports `GATE_BASE=<sha>` for CI; local fallback: merge-base with upstream, then `HEAD~1`.
- [x] 3.3 Add the CI step to `.github/workflows/test.yml` as warn-only; verify it triggers on a synthetic auth-only diff and stays silent on a docs-only diff outside the regex
  - Step added as warn-only (`::warning`, non-blocking) with PR-base/push-before sha resolution. Synthetic-diff verification done locally: auth-only diff → exit 1, covered diff → exit 0, opt-out → exit 0 with audit note. Full CI verification rides the fix-4 PR itself.
- [ ] 3.4 Flip the CI step to blocking after one green warn-only run; update AGENTS.md build/test section with the new command
  - AGENTS.md hardening is tracked under 5.3; flip happens after the first green warn-only run in CI.

## 4. Mutation canary

- [x] 4.1 Author mutation patches under `tests/auth-regression/mutations/`: capture name-filter, persist-discards-PSIDTS, stale-clobber save
  - `capture-name-filter.patch` (H6 class), `persist-discards-psidts.patch` (discarded-rotation class), `stale-clobber-save.patch` (#361 class); generated via `git diff` so they apply byte-exact.
- [x] 4.2 Implement the canary runner (clean worktree, apply patch, run suite, assert RED, fail loudly when a patch no longer applies)
  - `scripts/run-auth-mutation-canary.sh` (+ `bun run canary:auth`); refuses dirty trees, reverts via trap, treats patch-rot and surviving mutations as failures.
- [x] 4.3 Schedule nightly in CI; verify one full canary pass
  - `.github/workflows/auth-canary.yml` (nightly `0 3 * * *` + `workflow_dispatch`). Full local pass verified: all 3 mutations detected (suite RED each); first scheduled CI run pending merge.

## 5. Documentation consolidation

- [x] 5.1 Append the closing entry to `docs/phantom-bug-synthesis.md` (ledger closed; fix-1..3 landed), then move it, `auth-replacement-plan.md`, and `refactorings-phase-{1,2}.html` to `docs/archive/` with superseded-by banners
  - Closing entry appended 2026-08-16; all four files moved via `git mv` (history preserved) with archive banners naming the superseding docs.
- [x] 5.2 Create `docs/README.md` authority index (lifecycle doc > ablation findings > archive; everything else non-contradicting) and prune contradicting/stale sections in remaining docs to pointers
  - Live references to the moved files updated in `auth-cookie-lifecycle.md` (3 links), `cookie-ablation-findings.md`, `re-implement-through-v2-7-2.md`; `docs/archive/` internals kept consistent. OpenSpec change archives intentionally left as history.
- [x] 5.3 Harden `AGENTS.md`: auth-sensitive path list, docs authority order, same-PR rule (auth change ⇒ auth-regression suite run + lifecycle-doc changelog update), standing traps as pointers (static-`models()` probe ban, cookie-`expires` meaninglessness, name-filter ban)
  - New "Auth regression gate (fix-4)" section + the three commands added to the build/test block.

## 6. Verification and archive

- [x] 6.1 Full gates: `bun run typecheck`, `bun run lint:mediation` (bash form), `bun test` — baseline intact plus net additions recorded
  - typecheck clean; `bash scripts/lint-path-mediation.sh` clean; full suite 937 pass / 0 fail / 2 pre-existing skips (baseline 917 + 20 auth-regression tests); `bun run canary:auth` detects all 3 mutations; `bun run check:auth-gate` pass/fail/opt-out paths verified locally.
- [ ] 6.2 Verify gate + canary end-to-end in CI on a deliberately-injected local regression (screencap or log captured in PR)
  - Requires the fix-4 PR's CI runs (warn-only gate on its own diff) plus one nightly canary run; cannot be completed from a dev machine.
- [ ] 6.3 `openspec validate fix-4-auth-regression-guards --strict`; sync specs (`auth-regression-gate` new, `testing`/`domain-model` deltas) and archive the change
  - Blocked on 3.4 + 6.2 (CI-gated); archive after the first blocking-green run.
