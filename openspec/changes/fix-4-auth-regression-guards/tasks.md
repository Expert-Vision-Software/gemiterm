# Tasks: fix-4-auth-regression-guards

Prerequisite: fix-1, fix-2, fix-3 implemented and archived. Baseline test counts are recorded at implementation time (this change is additive-only to `src/`).

## 1. Fixtures and suite scaffolding

- [ ] 1.1 Create `tests/auth-regression/fixtures.ts` with the five jar builders (`freshFullJar`, `staleFullJar`, `phantomShapedJar`, `deadJar`, `trimmedFourCookieJar`), shapes derived from `docs/cookie-ablation-findings.md`, plus a per-file isolated `GEMITERM_CONFIG_DIR` bootstrap (no imports from the global mock-cookie fixtures)
- [ ] 1.2 Create the fake seams: driver fake (state-save output, page outcomes) and wire fake (init-token/listChats behavior per jar shape), injected through the existing DI surfaces

## 2. Invariant tests (one per historical bug class)

- [ ] 2.1 Full-jar capture integrity: capture persists every offered cookie; RED if any name-subset filter reappears (H6 / `REQUIRED_COOKIES` class)
- [ ] 2.2 Rotation propagation: PSIDTS value-change lands on disk via store save, detached refresh runner, and recovery rung; RED if any path discards the new value (discarded-rotation class)
- [ ] 2.3 Signed-out capture safety: no write, no overwrite of an existing jar on anonymous-cookie captures (save-on-login-page class)
- [ ] 2.4 CAS semantics: stale in-memory jar cannot clobber fresher disk PSIDTS (#361 class)
- [ ] 2.5 Validator contract: tier-1 raises on absent `__Secure-1PSID` or non-routable PSIDTS (expired / wrong-scope); tier-2 warns once on missing companions (#2061 class)
- [ ] 2.6 Classifier truth table: live / phantom / dead across jar shapes, deterministic on repeat
- [ ] 2.7 Probe purity: read-only classifier writes nothing and fires no rotation (byte-identical jar before/after)
- [ ] 2.8 Run `bun test tests/auth-regression` green; record net test-count delta vs pre-change baseline in this file

## 3. Gate mechanics

- [ ] 3.1 Author `AUTH_SENSITIVE_PATHS` list (paths + content regex incl. `docs/auth-cookie-lifecycle.md`) with a reviewed benign-allowlist file
- [ ] 3.2 Implement `scripts/check-auth-gate` (bash + pwsh parity, diff-driven with merge-base fallback, `SKIP_AUTH_REGRESSION_GATE=1` opt-out requiring a stated reason) and wire `bun run check:auth-gate`
- [ ] 3.3 Add the CI step to `.github/workflows/test.yml` as warn-only; verify it triggers on a synthetic auth-only diff and stays silent on a docs-only diff outside the regex
- [ ] 3.4 Flip the CI step to blocking after one green warn-only run; update AGENTS.md build/test section with the new command

## 4. Mutation canary

- [ ] 4.1 Author mutation patches under `tests/auth-regression/mutations/`: capture name-filter, persist-discards-PSIDTS, stale-clobber save
- [ ] 4.2 Implement the canary runner (clean worktree, apply patch, run suite, assert RED, fail loudly when a patch no longer applies)
- [ ] 4.3 Schedule nightly in CI; verify one full canary pass

## 5. Documentation consolidation

- [ ] 5.1 Append the closing entry to `docs/phantom-bug-synthesis.md` (ledger closed; fix-1..3 landed), then move it, `auth-replacement-plan.md`, and `refactorings-phase-{1,2}.html` to `docs/archive/` with superseded-by banners
- [ ] 5.2 Create `docs/README.md` authority index (lifecycle doc > ablation findings > archive; everything else non-contradicting) and prune contradicting/stale sections in remaining docs to pointers
- [ ] 5.3 Harden `AGENTS.md`: auth-sensitive path list, docs authority order, same-PR rule (auth change ⇒ auth-regression suite run + lifecycle-doc changelog update), standing traps as pointers (static-`models()` probe ban, cookie-`expires` meaninglessness, name-filter ban)

## 6. Verification and archive

- [ ] 6.1 Full gates: `bun run typecheck`, `bun run lint:mediation` (bash form), `bun test` — baseline intact plus net additions recorded
- [ ] 6.2 Verify gate + canary end-to-end in CI on a deliberately-injected local regression (screencap or log captured in PR)
- [ ] 6.3 `openspec validate fix-4-auth-regression-guards --strict`; sync specs (`auth-regression-gate` new, `testing`/`domain-model` deltas) and archive the change
