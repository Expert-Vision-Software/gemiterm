## Why

Seven command files (`list`, `fetch`, `new`, `continue`, `delete`, `export`, `export-all`) each carry a hand-rolled `for`/`switch` loop over `args` (about 285 lines total) that maps flags to a local options object. Each also carries a `showUsage()` that renders an `Options:` block with the same `chalk.bold` / `padEnd` / `chalk.cyan` / `chalk.dim` formatting (~100 lines total). `new` and `continue` additionally duplicate the same spillover-to-temp-file + load + cleanup sequence (~25 lines each). The duplication makes every new flag a multi-file edit and scatters arg-parsing behavior across eight modules.

## What Changes

- Add `src/cli/utils/command-args.ts` exporting a declarative `ArgFlagSpec`/`UsageSpec` model plus `parseCommandArgs(args, spec)` and `renderUsage(spec)`.
- Each of the seven commands replaces its `parseArgs()` body with a declarative flag spec fed to `parseCommandArgs`, and its `showUsage()` with `renderUsage`. The commands keep their positional-argument extraction and post-parse validation (e.g. `list --interactive` conflict detection, `new`/`continue` prompt-file rules).
- Extract the duplicated spillover/load/cleanup sequence into a shared `loadEffectivePrompt(message, promptFile)` helper in `src/cli/utils/prompt-file.ts`.
- No observable behavior change: flags, defaults, invalid-enum fallbacks, missing-value errors, exit codes, and help text are preserved. `auth` and `status` are out of scope (they use a subcommand dispatcher / `args.includes`, not the flag loop).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `commands`: Add a `Shared Command Argument Parsing` requirement documenting the declarative spec and the `parseCommandArgs` / `renderUsage` interface. No existing requirement's observable behavior changes.

## Impact

- **Code:** new `src/cli/utils/command-args.ts`; edit 7 command files and `src/cli/utils/prompt-file.ts`. Net deletion of ~300 lines.
- **Tests:** new `tests/cli/utils/command-args.test.ts`; existing command tests (help/flag assertions) must continue to pass unchanged.
- **Dependencies:** none.
