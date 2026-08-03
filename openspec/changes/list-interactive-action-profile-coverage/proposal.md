## Why

The code review of commit `807a7ea` ("fix(list-command): forward chat.profile to sub-commands in interactive action dispatch") identified a test coverage gap: the fix spreads `profileArgs` into five action dispatch calls (`view`, `export-markdown`, `export-json`, `continue`, `delete`), but only the `view` → `fetch` path has a regression test. The four remaining actions (`export-markdown`, `export-json`, `continue`, `delete`) are exercised by the existing test suite only in their non-profile-aware form (chats with no `profile` field), leaving the profile-forwarding behaviour untested for those paths.

## What Changes

- Add regression tests in `tests/cli/list-command.test.ts` for `export-markdown`, `export-json`, `continue`, and `delete` interactive actions asserting that `--profile <name>` is forwarded when the selected chat carries a `profile` field
- Each action gets at least one test covering the profile-forwarding argv shape
- No production code changes

## Capabilities

### New Capabilities

- `list-interactive-action-profile-coverage`: Regression tests for the interactive `list -i` action menu's profile-forwarding behaviour across all five sub-command dispatch paths

### Modified Capabilities

- None

## Impact

- `tests/cli/list-command.test.ts` — new tests added inside the existing `describe("action menu (single-pick dispatch)")` block
- No production code changes
- No breaking changes
