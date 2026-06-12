## Why

The top-level argv parser in `src/cli/index.ts` is a hand-rolled `parseGlobalFlags` function (60 lines) that recognizes only `--verbose/-v`, `--version`, and `--help/-h` and splits the rest into `remaining` for the `CommandRegistry`. This works but is the kind of boilerplate that a well-known library (already declared in `package.json` as `commander@^15.0.0` but never imported) eliminates cleanly. Replacing the hand-rolled parser with commander, encapsulated behind a `src/infrastructure/cli-parser.ts` wrapper, gives us the existing behavior plus battle-tested flag composition, future `--profile` / `--config-dir` / `--json` global flags without code growth, and consistent error output for free.

This change was originally bundled with the table-rendering refactor that landed in commit `e974923`; it was deferred to a separate change because it touches every subcommand's exit-path and is a much larger scope than table rendering.

## What Changes

- Add `commander@^15.0.0` as a real runtime dependency in `package.json` (already declared, currently unused). Reverse the cleanup task in the queued `cross-platform-build-and-ci` change that planned to remove it.
- Create `src/infrastructure/cli-parser.ts` that wraps `commander` behind a `parseGlobalArgs(argv): { flags, subcommand, subcommandArgs }` function. `commander` is imported only by this file.
- Replace the hand-rolled `parseGlobalFlags` in `src/cli/index.ts` with `parseGlobalArgs`. The hand-rolled function is deleted.
- Keep the `CommandRegistry` and the per-subcommand `execute(args, context)` contract unchanged. Subcommands continue to parse their own flags from the `args` string array they receive. **No changes** to `src/cli/commands/*.ts` are required for this change.
- No visual or behavioral change to `--help` / `--version` / `--verbose` output. The existing test suite must continue to pass without modification of the formatters/CLI-output tests.
- Update the `cli` capability's "Global Flags Parsing" requirement to describe the commander-backed interface, with the same observable behavior preserved.

## Capabilities

### New Capabilities

None. The change fits into the existing `cli` capability.

### Modified Capabilities

- `cli`: The "Global Flags Parsing" requirement is updated to specify that the parser is backed by the `commander` library (encapsulated in `src/infrastructure/cli-parser.ts`). The observable behavior (recognized flags, exit codes, error messages) is preserved, so the existing scenarios remain valid. The new requirement additionally documents that future global flags are added via commander in the same wrapper, not via the hand-rolled parser.

## Impact

- **Code:** `src/cli/index.ts` (replace `parseGlobalFlags`, ~50 lines deleted), new `src/infrastructure/cli-parser.ts` (~30 lines).
- **Dependencies:** `commander@^15.0.0` is already in `package.json`; this change activates it. No new dep is added.
- **Tests:** Existing CLI tests (smoke, status command, etc.) should pass unchanged. New unit tests for `parseGlobalArgs` in `tests/infrastructure/cli-parser.test.ts`.
- **Cross-cutting:** Task 14.3 in the `cross-platform-build-and-ci` change currently plans to *remove* `commander` from `package.json` as a cleanup step. That task is superseded by this change; the cleanup PR should be updated before the CI work lands, or the cleanup PR can be rebased onto this change first.
