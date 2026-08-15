# Design: fix-4-auth-regression-guards

## Context

fix-1 lands `src/auth/` (`CookieSession` facade + `BrowserRefresher` + `CookieStore` + validators + classifier + recovery). fix-2 wires detection into `list`/`status`. fix-3 adds REPL keepalive. The historical failure mode was never "no tests" — the repo ran 900+ green tests while phantom-auth shipped in three releases — it was tests that exercised everything *except* the invariant at fault (Phase 0 v1's "constant-ok fake" is the canonical example, `docs/phantom-bug-synthesis.md` 2026-08-08). This change therefore optimizes for two properties: **invariant-first tests** (each maps 1:1 to a ledger bug class, asserted through public surfaces against on-disk truth) and **gate reachability** (changing auth code without touching the gate is impossible to overlook in CI).

Constraints: Bun test runner; path-mediation lint (`scripts/lint-path-mediation.sh`, bash form on Windows); prompt-layer facade untouched; no production-code changes in this change; CI is `ubuntu-latest` (gate must be shell/OS-portable).

## Goals / Non-Goals

**Goals**
- Every historical bug class from the ledger has a named, failing-if-reintroduced test through the public surface.
- CI fails when an auth-sensitive path changes without `tests/auth-regression/` changing.
- One authoritative doc chain; agents have a rule (not judgment) for resolving conflicts.
- The gate itself is verified (mutation canary) so it cannot silently rot into constant-ok.

**Non-Goals**
- Refactoring fix-1..3 implementation code.
- Network/live-Google tests in CI (all regression tests run against fakes at the driver/seam level; live verification stays a user-driven step).
- Blocking non-auth changes (gate triggers only on the auth-sensitive path list).
- A git hook that cannot be bypassed (opt-out exists; friction, not absolutism).

## Decisions

### D1 — Fixture seam: fake at the transport/driver boundary, truth on disk

Tests inject a fake `PlaywrightRunner`/driver (existing pattern from `tests/services/playwright-cli-driver.test.ts`) and a fake wire layer; everything above — `CookieSession`, `CookieStore`, classifier, recovery — runs real. Assertions read the **on-disk** `storage_state.json` (via the test config dir) plus PSIDTS **values** (never logged). Rationale: the ledger bugs were all "plausible code, corrupt artifact"; asserting on the artifact closes the constant-ok loophole. Alternative rejected: asserting on return values only (that is exactly what failed before).

### D2 — Jar-shape registry as first-class fixtures

`tests/auth-regression/fixtures.ts` exposes typed jar builders: `freshFullJar()`, `staleFullJar()` (PSIDTS value aged via injected clock), `phantomShapedJar()` (tokens present, listChats empty at the fake wire), `deadJar()` (no tokens), `trimmedFourCookieJar()` (the historical artifact, kept so its "works-when-fresh / fails-when-superseded" behavior is pinned). Rationale: named shapes make test intent legible and make the ablation findings executable. The shapes derive from `docs/cookie-ablation-findings.md`, not from production code.

### D3 — Gate mechanics: diff-driven check, not blame-driven

`scripts/check-auth-gate` compares the merge-base..HEAD diff (fallback: working tree in local mode) against `AUTH_SENSITIVE_PATHS` (glob list owned by this suite: `src/auth/**`, `src/services/playwright-cli-driver.ts`, `src/services/gemini-client-wrapper.ts`, `src/services/profile-lifecycle.ts`, `src/infrastructure/storage.ts`, plus a content regex `cookie|PSID|storage_state|CookieSession|silentRefresh|rotate` over changed files). Trigger without `tests/auth-regression/**` in the same diff → exit 1 with a message naming the opt-out and its reason requirement. Lives as a CI step AND a `bun run check:auth-gate` local command. Alternatives rejected: CODEOWNERS (no review enforcement here), a custom pre-commit hook (bypassable, Windows shell variance); the diff check is the cheapest always-on surface.

### D4 — Mutation canary: nightly, sandboxed, ledger-shaped

A script re-applies each historical bug shape as a temporary source patch in a clean worktree (name-filter in capture, PSIDTS-discard in persist, stale-clobber in save), runs `bun test tests/auth-regression`, and asserts non-zero exit each time. Runs nightly in CI (`schedule:`), not per-push (runtime ~3× suite). Rationale: proves the gate bites; per-push cost unjustified. Each mutation is a small, versioned patch file under `tests/auth-regression/mutations/` — if a mutation no longer applies because fix-1 code moved, the canary fails loudly and the mutation is updated deliberately.

### D5 — Documentation authority order encoded in `docs/README.md` + AGENTS.md

Order: (1) `docs/auth-cookie-lifecycle.md` — canonical, validated; (2) `docs/cookie-ablation-findings.md` — empirical record; (3) `docs/archive/**` — history, never normative; (4) everything else — must not contradict (1). Moves: `phantom-bug-synthesis.md` gets a closing ledger entry (fix-1..3 landed; ledger closed) then moves to `docs/archive/`; `auth-replacement-plan.md`, `refactorings-phase-{1,2}.html` follow. Cross-references elsewhere are pruned to pointers. Rationale: the exact confusion that fueled the saga — agents reading superseded conclusions as current — becomes structurally impossible to repeat without also editing the authority index, which the gate's content regex partially covers (`docs/auth-cookie-lifecycle.md` is itself an auth-sensitive path).

### D6 — Isolation from global setup

`tests/auth-regression/` uses its own config-dir bootstrap (fresh `GEMITERM_CONFIG_DIR` per test file) and never imports the repo's mock-cookie globals, so a change to shared mocks cannot silently satisfy auth invariants. Rationale: the suite's value is independence; sharing fixtures would re-create the drift that defeated Phase 0 v1.

## Risks / Trade-offs

- [Gate regex over-matches (e.g., unrelated file mentions "cookie" in a string)] → Mitigation: regex matches *changed hunks*, path list is primary; one-line allowlist file for known-benign paths, reviewed in PR.
- [Mutation patches rot as fix-1 code evolves] → Mitigation: canary failure is the rot detector; updating a mutation is an explicit, reviewed act (D4).
- [Archived docs still crawled by agents] → Mitigation: every archived file gets a top banner "ARCHIVED — superseded by docs/auth-cookie-lifecycle.md; not normative"; AGENTS.md authority rule.
- [Opt-out becomes routine] → Mitigation: opt-out requires `SKIP_AUTH_REGRESSION_GATE=1` AND a reason line; CI prints an audit summary of opt-outs per release.
- [Nightly canary flakiness] → Mitigation: mutations run against deterministic fakes; no network.

## Migration Plan

1. Land after fix-3 archive; verify suite green on untouched tree.
2. Add gate to CI as non-blocking (warn-only) for one week → flip to blocking.
3. Nightly canary added after gate is blocking.
Rollback: revert the CI step; the suite itself is additive and safe.

## Open Questions

- Should the gate also cover `openspec/specs/auth/spec.md` edits (spec-level auth changes) in the same trigger? Lean yes — the content regex already catches most; decide at implementation.
- Where the audit of gate opt-outs lives (release notes vs CHANGELOG) — implementation detail, decide then.
