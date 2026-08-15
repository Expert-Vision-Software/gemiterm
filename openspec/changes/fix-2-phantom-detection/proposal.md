# Proposal: fix-2-phantom-detection

Sequence: fix-2 of 3. Depends on fix-1 `cookie-session-core` (uses its `CookieSession.probe` classifier and recovery rung). Evidence base: `docs/cookie-ablation-findings.md` - the phantom state (init tokens present, `listChats` returns 0) and the dead state (no tokens) are distinguishable only by network-honest probing; nothing client-side predicts decay.

## Why

fix-1 makes sessions refresh proactively (detached, opportunistic) and provides the classifier + recovery rung, but nothing wires them into the command layer: a command that arms a session already inside the phantom window still returns an unexplained `No conversations found.`, and `status` still reports locally-valid cookies with no server-side truth. The 2026-08-11 ledger entry (reactive phantom detection) established the design: detect at the response layer, not the auth gate - react after the fact instead of predicting.

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
- **Not changed**: non-interactive stdout of `list` (guarded by `tests/integration/commands/list.test.ts`) and default `status` output; multi-profile (`--all-profiles`) listing paths skip classification (per the 2026-08-11 design).
- **Tests**: classifier interaction tested at fake seams; byte-equivalence suite must stay green. Baseline at time of writing: whatever fix-1 records in its tasks (862/2/0/1748 pre-fix-1).
- **Dependencies**: none beyond fix-1.
