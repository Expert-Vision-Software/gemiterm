## Why

`text()` in `src/cli/utils/prompts.ts` is a 118-line hand-rolled raw terminal input loop: manual ANSI escape handling (Delete `\x1b[3~` only), multi-byte UTF-8 decoding, backspace logic, a hardcoded Ctrl-C handler, `stdin.setRawMode(true)` and manual listener cleanup. It reimplements what `@inquirer/input` already provides and is fragile — it handles Delete but not Home, End, or arrow keys. `@inquirer/prompts` (which already re-exports `@inquirer/input`) is already the project's only prompt facade, so this is a pure deletion with a leverage win.

## What Changes

- Replace the 118-line `text()` implementation with a thin wrapper around `@inquirer/input`, configured with the existing shared `theme` and the module-level abort `signal` (the same wiring used by `confirm()` and `select()`).
- Keep the `TextOptions` interface, the `requireTty()` gate, and the `mapCancellation` mapping to `CancellationError` unchanged.
- Delete the raw-byte loop, `setRawMode`, manual `data` listener, and inline ANSI/UTF-8 decoding.
- Arrow keys, Home, End, and paste become free from `@inquirer/input`; inline validation errors render through the shared theme's `style.error`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prompt-layer`: `text` is now explicitly a thin wrapper over `@inquirer/input` (the prior spec already stated this, but the code was hand-rolled); the raw-byte terminal handling is removed and cursor-key/Home/End editing is supported.

## Impact

- **Code:** `src/cli/utils/prompts.ts` only (~100 lines deleted; `input` added to the existing `@inquirer/prompts` import).
- **Tests:** existing `tests/cli/utils/prompts.test.ts` TTY-gate / error-hierarchy / abort-signal tests continue to pass; add coverage that `text` returns the typed value via `@inquirer/testing`'s renderer.
- **Dependencies:** none (`@inquirer/prompts`/`@inquirer/input` already present; `@inquirer/testing` is a devDependency).
