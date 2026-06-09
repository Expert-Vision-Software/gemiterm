## Why

The `new` and `continue` commands both implement interactive chat loops using `createInterface` from `node:readline`, but the `startInteractive` logic is duplicated in each command with minor variations. Additionally, the `new` command's interactive mode has a bug where it exits after processing just one message instead of looping until the user quits.

## What Changes

- Extract shared `startInteractive` logic into a reusable utility function/class
- Fix the bug where `new` command's interactive mode exits after one round
- Reduce code duplication between `new-command.ts` and `continue-command.ts`

## Capabilities

### New Capabilities
- `interactive-prompt-loop`: Shared interactive prompt loop utility for chat commands

### Modified Capabilities
<!-- No spec-level behavior changes - this is a pure refactoring with a bug fix -->

## Impact

- Files affected: `src/cli/commands/new-command.ts`, `src/cli/commands/continue-command.ts`
- New file: `src/cli/utils/interactive-prompt.ts` (or similar shared location)