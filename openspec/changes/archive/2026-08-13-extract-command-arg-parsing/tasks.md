## 1. Shared parser module

- [ ] 1.1 Create `src/cli/utils/command-args.ts` with `ArgFlagType`, `ArgFlagSpec`, `UsageSpec`, `parseCommandArgs`, and `renderUsage`.
- [ ] 1.2 Add unit tests `tests/cli/utils/command-args.test.ts` covering boolean/string-tolerated/string-required/integer/enum parsing, aliases, the required-value error exit, and `renderUsage` output.

## 2. Convert commands

- [ ] 2.1 `list-command.ts`: replace `parseArgs` with a spec + `parseCommandArgs`; replace `showUsage` with `renderUsage`; keep `--interactive` post-processing and conflict detection.
- [ ] 2.2 `fetch-command.ts`: same; keep `extractConversationId`.
- [ ] 2.3 `delete-command.ts`: same.
- [ ] 2.4 `export-command.ts`: same.
- [ ] 2.5 `export-all-command.ts`: same.
- [ ] 2.6 `new-command.ts`: replace `parseArgs` (required-value flags) + `showUsage`; replace the spillover block with `loadEffectivePrompt`.
- [ ] 2.7 `continue-command.ts`: same as `new`.

## 3. Spillover helper

- [ ] 3.1 Add `loadEffectivePrompt` to `src/cli/utils/prompt-file.ts` and use it in `new`/`continue`.

## 4. Verify

- [ ] 4.1 `bun run typecheck` clean.
- [ ] 4.2 `bun test` full suite green (baseline 797 pass, 0 fail) plus new `command-args.test.ts` cases.
- [ ] 4.3 `bash scripts/lint-path-mediation.sh` clean.
