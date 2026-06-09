## Context

The `new` and `continue` commands both implement interactive chat loops using `node:readline`'s `createInterface`. Both have essentially identical `startInteractive` implementations with only minor differences in:
- How messages are processed (new chat vs. send to existing)
- Profile resolution logic

## Goals / Non-Goals

**Goals:**
- Extract shared interactive prompt logic into a reusable utility
- Fix the bug where `new` command's interactive mode exits after one round
- Reduce code duplication

**Non-Goals:**
- No new external dependencies
- No changes to command-line argument parsing
- No changes to the CLI command interface

## Decisions

1. **Create `src/cli/utils/interactive-prompt.ts`** as a shared utility module
2. **Export a `runInteractiveLoop` function** that accepts a callback for message handling
3. **Keep command-specific logic in the commands** - the shared utility handles only the prompt loop mechanics

## Risks / Trade-offs

- Minimal risk - this is a pure refactoring with no behavioral changes beyond fixing the bug
- Trade-off: adds a new file, but reduces overall complexity