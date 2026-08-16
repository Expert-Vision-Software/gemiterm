# Tasks: fix-3b-auth-regressions

Baseline: post-fix-3 suite (905 pass / 2 skip / 0 fail / 1934 expects / 61 files). Run `bun run typecheck` after each group; conventional commits; never push. Ordering dependency: land after fix-3 is archived (two deltas modify requirements fix-3 added).

## 1. Shared rotation floor

- [x] 1.1 Implement the per-profile `RotationCooldown` seam (`canRotate(profile, now)` / `record(profile, now)`, 60 s floor default, injectable clock): constructed once in `createCookieSession`, injected into `CookieSessionDeps` and — via the keepalive factory — into `SessionKeepaliveDeps`; `SessionKeepalive` replaces its private `lastRotationTime` floor logic with the shared cooldown (baseline-comparison fast path stays in the keepalive)
- [x] 1.2 Enforce the floor in `CookieSession.refresh(profile)`: consult the cooldown before `rotatePsidts`, record on `rotated: true`, and resolve `{ rotated: false }` with a debug log when suppressed
- [x] 1.3 RED-first tests for both directions: manual `refresh` 30 s after a keepalive rotation resolves `{ rotated: false }` without touching the refresher; a keepalive tick 30 s after a manual rotation skips the browser and reschedules; a manual refresh after the floor window expires rotates normally

## 2. Keepalive factory and unconditional REPL wiring

- [x] 2.1 Add `CookieSession.createKeepalive(profile, options?)` returning a wired `SessionKeepalive` (facade's cookie store, refresher, shared cooldown, scoped logger); delete the `cookieStore`/`refresher` getters and `SessionKeepalive.getLastRotationTime()`; update `CookieSessionDeps`/`SessionKeepaliveDeps` types accordingly
- [x] 2.2 In `new-command.ts` and `continue-command.ts`: resolve the effective profile via `profileName ?? await getDefaultProfileName()` (removing the literal `"default"` fallback) and construct the keepalive unconditionally for interactive sessions (`message === null`) via `context.cookieSession.createKeepalive(effectiveProfile)`
- [x] 2.3 RED-first tests: factory wiring test (returned loop uses the facade's injected collaborators and shared cooldown — verified via a fake refresher seeing rotations from both `refresh` and `tick`); `continue` REPL with `profileName === null` still starts exactly one keepalive for the default profile; `new` uses the configured default profile name, never the literal `"default"`; one-shot paths construct no keepalive (regression guard from fix-3 task 2.2 stays green)

## 3. Prompt facade re-export removal

- [x] 3.1 Remove `export { CancellationError, text }` from `src/cli/utils/interactive-prompt.ts`; switch `chat-session.ts` to import both from `./prompts.ts` (grep gate: no file imports `CancellationError` or `text` from `interactive-prompt.ts`)
- [x] 3.2 RED-first contract test pinning the no-re-export rule: reading `src/cli/utils/interactive-prompt.ts` finds no re-export of facade symbols (greppable pin, same style as `tests/auth/full-jar-contract.test.ts`)

## 4. Verification

- [x] 4.1 Full suite green; net test count recorded here; `bun run typecheck` clean; mediation lint clean (bash form; the PowerShell form's exempt-file false positives are documented in AGENTS.md)
  - Result: 917 pass / 2 skip / 0 fail / 1966 expects / 62 files (baseline 905 pass / 2 skip / 0 fail / 1934 expects / 61 files — net +12 tests, +1 file). `tsc --noEmit` clean. `bash scripts/lint-path-mediation.sh` via Git Bash: OK.
