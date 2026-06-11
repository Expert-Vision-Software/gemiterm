## 1. Setup

- [x] 1.1 Verify `commander@^15.0.0` is in `package.json` dependencies; if not, run `bun add commander@^15.0.0` and commit the `package.json` + `bun.lock` change.
- [x] 1.2 Confirm the `commander` package is importable from `src/` with `bun -e 'import { Command } from "commander"; console.log(Command.name)'` (smoke check, no code change).

## 2. Create the wrapper

- [x] 2.1 Create `src/infrastructure/cli-parser.ts` exporting `parseGlobalArgs(argv: string[]): { flags, subcommand, subcommandArgs }` and a `printHelp(registry)` + `printVersion(pkgVersion)` helper. Internally use `import { Command, CommanderError } from "commander"`. The file is the only one that imports `commander`.
- [x] 2.2 Wire commander to expose `-v/--verbose`, `--version`, `-h/--help` as global flags; treat everything else as subcommand args. Use `program.exitOverride()` and `program.allowUnknownOption(true)` so the wrapper controls exit and dispatches unknown subcommands to the existing `CommandRegistry.getHandler` path.
- [x] 2.3 Catch `CommanderError` in the wrapper; re-throw a `new Error("gemiterm: " + commanderError.message)`.

## 3. Wire up `src/cli/index.ts`

- [x] 3.1 Delete the hand-rolled `parseGlobalFlags` function (lines 39-60 of the current `src/cli/index.ts`).
- [x] 3.2 Replace the call in `main()`: `const { flags, remaining } = parseGlobalFlags(args)` becomes `const { flags, subcommand, subcommandArgs } = parseGlobalArgs(args)`. Update the subsequent `remaining[0]` / `remaining.slice(1)` usages to use the destructured fields.
- [x] 3.3 Replace the inline `console.log("gemiterm v" + pkg.version)` / `process.exit(0)` in the version branch with a call to the wrapper's `printVersion(pkg.version)`. Same for `--help` → `printHelp(registry)`.
- [x] 3.4 Verify no `import ... from "commander"` was added to `src/cli/index.ts` or any file under `src/cli/commands/`.

## 4. Tests

- [x] 4.1 Create `tests/infrastructure/cli-parser.test.ts` with unit tests covering: `--verbose` long, `-v` short, `--version`, `--help` long, `-h` short, subcommand passthrough, subcommand-args passthrough, and the unknown-option error path. Each test asserts on the shape returned by `parseGlobalArgs`, not on process state.
- [x] 4.2 If any existing unit test references `parseGlobalFlags` (search `tests/` for that symbol), rename it to `parseGlobalArgs` and update assertions. Expected: zero matches given the function is module-private to `index.ts` and was never exported.

## 5. Verify

- [ ] 5.1 Run `bun run test` and confirm the test count is at least 502 (current baseline) + new cli-parser tests. The one pre-existing `Smoke Tests > status runs without crashing` failure remains (unrelated).
- [ ] 5.2 Run `bun run typecheck` and confirm clean.
- [ ] 5.3 Run `bun run lint:mediation:ps` and confirm clean (no new `node:fs` / `node:path` / `node:os` imports introduced).
- [ ] 5.4 Manual smoke: `bun run src/cli/index.ts --version` prints `gemiterm v2.0.0` and exits 0; `bun run src/cli/index.ts --help` prints the existing help screen; `bun run src/cli/index.ts --bogus` exits 1 with a `gemiterm: ...` message; `bun run src/cli/index.ts status` runs the status command end-to-end against `.gemiterm/profiles/default/storage_state.json`.

## 6. Cross-cutting cleanup

- [x] 6.1 Update `openspec/changes/cross-platform-build-and-ci/tasks.md` task 14.3 to mark it as superseded by `commander-cli-parser`, or delete the task entirely. The CI change's cleanup PR must be rebased onto this change's commit.
