## Context

The current top-level argv parser is a 60-line hand-rolled function in `src/cli/index.ts:39-60` called `parseGlobalFlags`. It walks `process.argv.slice(2)`, picks out `--verbose` / `-v`, `--version`, `--help` / `-h`, and returns `{ flags, remaining }`. The first non-flag token in `remaining` is the subcommand; the rest become `subcommandArgs` and are passed to `CommandRegistry.getHandler(subcommand).execute(args, context)`.

This change activates `commander@^15.0.0` (already in `package.json`, never imported) and replaces the hand-rolled parser with a thin wrapper around commander that preserves the same observable behavior. Per the proposal, no subcommand-level parsing is touched: each `CliCommand.execute(args, context)` continues to receive a `string[]` and parses its own flags.

A previous design round considered rolling our own `renderTable()` helper for tables (commit `e974923`) without adding a dep. The tables work adopted `cli-table3` via an `src/infrastructure/cli-table.ts` wrapper. This change follows the same encapsulation pattern for `commander` via `src/infrastructure/cli-parser.ts`.

## Goals / Non-Goals

**Goals:**

- Replace the 60-line hand-rolled `parseGlobalFlags` in `src/cli/index.ts` with a call to a new `parseGlobalArgs` in `src/infrastructure/cli-parser.ts` that wraps `commander`.
- Preserve every observable behavior of the current parser: recognized flags, exit codes, error messages, and the "no args → show help" path. The existing test suite must pass without modification.
- Encapsulate `commander` so it is imported by exactly one file. The rest of the codebase never sees `import { Command } from "commander"`.
- Make it trivial to add a future global flag (e.g. `--profile`, `--config-dir`, `--json`) by editing only `src/infrastructure/cli-parser.ts` and adding a one-liner to the commander `.option()` chain.

**Non-Goals:**

- Refactoring the 11 subcommand argument parsers in `src/cli/commands/*.ts` to also use commander. Each subcommand has its own bespoke parsing (e.g. `ListCommand.parseArgs`) that would require per-command migration. This is deferred to a future change.
- Changing the `CliCommand.execute(args, context)` contract.
- Changing the `CommandRegistry` interface.
- Removing `commander` from `package.json` (the opposite: this change activates it). The `cross-platform-build-and-ci` change's task 14.3 ("remove unused commander dep") is superseded by this change.
- Adding new global flags. The wrapper exposes `--verbose / -v`, `--version`, `--help / -h` only — the same set the hand-rolled parser supported.

## Decisions

### Decision 1: Wrap commander, don't replace the public surface

`src/infrastructure/cli-parser.ts` exports a single function:

```ts
export interface ParsedArgs {
  flags: { verbose: boolean; version: boolean; help: boolean };
  subcommand: string | null;
  subcommandArgs: string[];
}

export function parseGlobalArgs(argv: string[]): ParsedArgs;
```

`src/cli/index.ts` calls `parseGlobalArgs(process.argv.slice(2))` and uses the returned fields. The shape matches the existing `{ flags, subcommand, subcommandArgs }` that `main()` already destructures (lines 156-181 of the current file), so the consumer side needs only a rename of the local variable.

**Rationale:** Mirrors the `renderTable()` wrapper pattern from the tables refactor (commit `e974923`, `src/infrastructure/cli-table.ts`). The wrapper file owns the third-party import; callers see a stable, project-shaped API. If commander is later replaced with `yargs` or `cac`, the change is a one-file edit.

**Alternatives considered:**

- *(A) Let subcommands import commander directly.* Rejected: spreads the third-party import across 11+ files, violating the "wrap at the infrastructure layer" pattern.
- *(B) Define a full `CliArgs` builder DSL.* Rejected: overkill for three flags. A 30-line wrapper is the right size.
- *(C) Migrate each subcommand's flag parser to commander in the same change.* Rejected: this is a 500-1000 line refactor across 11 files, with a much higher test surface. Out of scope per the proposal.

### Decision 2: Subcommand dispatch stays in `index.ts`

`parseGlobalArgs` does not know which subcommands exist. It returns the raw subcommand string + args; `CommandRegistry.getHandler(subcommand)` is still called from `main()`. Commander's `.command()` API is not used.

**Rationale:** The existing `CommandRegistry` is the source of truth for registered subcommands. Routing commander through it would either require duplicating the registry into commander (and keeping them in sync) or making commander call into the registry (an awkward inversion). The simpler approach: commander parses the global flags, hand-off to the registry unchanged.

**Alternatives considered:**

- *(A) Use `program.command("auth").action(handler)`. Rejected: each handler is currently a class that takes constructor args from the registry. The action callback would lose the `CliCommandContext` (mediator, profileAuthManager, verbose). Either we thread that context through commander (extra plumbing) or we drop the registry (large refactor). Neither is justified.
- *(B) `program.allowUnknownOption(true)` and let the registry handle dispatch. This is what we'll actually do: commander parses only the three recognized flags, everything else becomes `subcommandArgs`.

### Decision 3: Help and version output stays project-shaped

Commander's built-in `--help` and `--version` formatting is bypassed. The wrapper exposes a `printHelp(registry)` and `printVersion(pkgVersion)` helper that delegates to the existing `showHelp(registry)` and the existing `console.log("gemiterm v" + pkg.version)` paths.

**Rationale:** The existing help screen (from `src/cli/commands/help.ts`) is project-styled and lists subcommands with descriptions. Commander's default help would replace it with a generic, less informative screen. Same for version: existing output is `gemiterm v2.0.0`; commander's default would print a different format.

**Implementation:** The wrapper calls `program.exitOverride()` so commander never calls `process.exit` itself. The wrapper inspects the parsed result and calls the project's helpers when `--help` or `--version` is detected.

**Alternatives considered:**

- *(A) Reformat `showHelp(registry)` into commander's `.addHelpText()` API.* Rejected: doesn't save code (same content, different shape) and the project uses the existing format in the smoke test.
- *(B) Print commander's default help. Rejected: worse UX.

### Decision 4: Errors are handled, not thrown

When the user passes an unknown global flag (e.g. `--bogus`), commander throws a `CommanderError`. The wrapper catches `CommanderError` and re-formats the message to match the existing "Unknown command" / suggestion path style. The process exits with code 1 (matching the existing `process.exit(1)` at `index.ts:194`).

**Rationale:** Preserves the existing error UX (`Unknown command: 'foo' / Did you mean one of: ...`) and the existing exit-code contract.

### Decision 5: No new tests, reuse existing

The proposal promises "existing test suite must pass without modification". The smoke tests in `tests/smoke/smoke.test.ts` exercise `--help`, `--version`, and `status` end-to-end. The `tests/cli/*.test.ts` files exercise subcommand dispatch. The unit tests for `parseGlobalFlags` (if any exist) need to be migrated to test `parseGlobalArgs` instead.

A new `tests/infrastructure/cli-parser.test.ts` adds 5-8 focused unit tests for the wrapper to lock in the contract: known flags, unknown flags, no-args, help short alias, version short alias, subcommand passthrough, subcommand-args passthrough. This is the only new test file.

## Risks / Trade-offs

- **[Risk] Commander's default help text leaks through if a future flag is added incorrectly.** → Mitigation: the wrapper does not call `program.helpInformation()` or `program.outputHelp()`. All help output is routed through the project's `showHelp(registry)`.
- **[Risk] Commander's exit codes differ from the existing code for the same error.** → Mitigation: the wrapper catches `CommanderError` and re-emits the existing error format. The smoke tests assert exit code 0 for `--help` and `--version`; we route through the same code path that previously set those codes.
- **[Risk] Test for unknown-command message format breaks because commander rewords the suggestion.** → Mitigation: commander is not used for subcommand lookup. The "Did you mean one of:" path is unchanged in `index.ts:184-194`. Commander is only responsible for flag parsing; it never sees a subcommand string.
- **[Risk] `commander@^15.0.0` ESM/CJS interop issue with Bun.** → Mitigation: commander 15 is published as ESM with `exports` map. Bun has first-class ESM support. If an issue is found, fall back to `commander@^12.x` (the last CJS line).
- **[Risk] Adding this change re-enables `commander` in `package.json` while the queued `cross-platform-build-and-ci` change has a task to *remove* it as cleanup.** → Mitigation: the apply pass for this change should land first; then the CI change's task 14.3 needs to be edited to remove the cleanup task, or rebased on top of this change.

## Migration Plan

1. Apply this change in a single commit on `gemiterm-bun-rewrite`.
2. After the change lands, edit `openspec/changes/cross-platform-build-and-ci/tasks.md` task 14.3 to mark it as superseded (or delete it). The cleanup PR for the CI change should be rebased onto this commit before merging.
3. No data migration. No user-visible change.

Rollback: `git revert <commit>`; the previous hand-rolled parser is still in the commit history.

## Open Questions

- Should we expose `--no-color` as a global flag in the same change, given that `chalk` is now in use? **Recommendation: defer to a future change.** It is not in scope of the current proposal and would require touching every subcommand's output path. Not blocking this change.
- Should we add `--json` as a global flag for machine-readable output? **Recommendation: defer.** The per-subcommand `--format json` is already supported where needed (e.g. `list --format json`).
