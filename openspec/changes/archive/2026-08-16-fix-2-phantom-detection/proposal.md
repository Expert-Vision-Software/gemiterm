# Proposal: fix-2-phantom-detection

Sequence: fix-2 of 4. Depends on fix-1 `cookie-session-core` — **landed and archived 2026-08-16** (`openspec/changes/archive/2026-08-16-fix-1-cookie-session-core`; post-landing suite 865 pass / 2 skip / 0 fail / 1824 expects / 60 files). Uses fix-1's `CookieSession.probe` classifier and recovery rung. Evidence base: `docs/cookie-ablation-findings.md` (the phantom state (init tokens present, `listChats` returns 0) and the dead state (no tokens) are distinguishable only by network-honest probing; nothing client-side predicts decay) plus the 2026-08-16 ledger entry in `docs/phantom-bug-synthesis.md`.

## Why

fix-1 makes sessions refresh proactively (detached, opportunistic — now verified live: the runner survives the CLI process tree, logs to `<configDir>/gemiterm.log`, and rotates a stale jar in ~8 s) and provides the classifier + recovery rung, but nothing wires them into the command layer. **Priority driver, captured live on 2026-08-16 (fix-1 task 7.4):** `list` OK at 00:55Z, "No conversations found." at 04:38Z after 3 h 43 m idle — the first post-idle `list` arms the stale jar and returns the unexplained empty result while the detached runner only rotates the jar *after* the command has already answered. The first-post-idle guarantee (design D2/D5 of fix-1) is exactly this change: detect the phantom at the response layer and bridge to recovery instead of printing a bare empty list. `status` still reports locally-valid cookies with no server-side truth. The 2026-08-11 ledger entry (reactive phantom detection) established the design: react after the fact instead of predicting.

## What Changes

- `gemiterm list` (single-profile queries only): when `listChats` returns zero conversations, run the classifier; on `phantom`, offer the existing re-auth flow (interactive confirm + recovery + retry the query once) on a TTY, or print a stderr diagnostic in non-interactive mode. Stdout bytes of the non-interactive list path are unchanged.
- `gemiterm status --verbose`: adds a PROBE column backed by the read-only classifier - `live (N)`, `phantom`, or `dead` - gated behind the new `--verbose` flag; without the flag, `status` output is unchanged.
- No changes to capture, storage, refresh, or validation (all fix-1 surface).

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `commands`: adds two requirements - `StatusCommand --verbose` session probe and `ListCommand` reactive phantom detection with the stdout byte-stability guarantee.

## Impact

- **Code**: `src/cli/commands/list-command.ts` (post-query classification + retry), `src/cli/commands/status-command.ts` (`--verbose` flag + probe column), `src/cli/utils/gemini-queries.ts` (single-profile query plumbing), arg specs for both commands.
- **Not changed**: non-interactive stdout of `list` (guarded by `tests/integration/commands/list.test.ts`) and default `status` output; multi-profile (`--all-profiles`) listing paths skip classification (per the 2026-08-11 design); fix-1's capture/store/refresh/validation surface.
- **Tests**: classifier interaction tested at fake seams; byte-equivalence suite must stay green. Baseline (fix-1 post-landing, recorded in its archived tasks): 865 pass / 2 skip / 0 fail / 1824 expects / 60 files.
- **Dependencies**: fix-1 (landed). The recovery-offer path leans on two fix-1-verified properties: recovery failures always surface the typed `AuthenticationError` (re-arm failures included, commit `e567ff0`) preserving the headed re-login prompt contract, and every detached rotation is observable in `<configDir>/gemiterm.log` for post-hoc diagnosis.
- **Known gap deliberately excluded**: the detached spawn resolves `refresh-runner.ts` from `import.meta.dir`, which does not exist beside compiled `dist/gemiterm` builds — a build-surface follow-up, not command-layer scope.
