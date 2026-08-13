## 1. Replace text()

- [ ] 1.1 Add `input as inquirerInput` to the existing `@inquirer/prompts` import in `src/cli/utils/prompts.ts`.
- [ ] 1.2 Replace the 118-line `text()` body with the `@inquirer/input` wrapper (TTY gate + theme + signal + `mapCancellation`).
- [ ] 1.3 Delete the now-unused raw-byte helpers (the inline `onData` closure, `render`, `finish`, `cancel`, `cleanup`).

## 2. Tests

- [ ] 2.1 Add `@inquirer/testing`-backed tests in `tests/cli/utils/prompts.test.ts` for `text`: typed value returns; `default` resolves when the user submits empty; `validate` re-prompts on failure; Ctrl-C maps to `CancellationError`.
- [ ] 2.2 Confirm existing TTY-gate / error-hierarchy / abort-signal tests still pass unchanged.

## 3. Verify

- [ ] 3.1 `bun run typecheck` clean.
- [ ] 3.2 `bun test` full suite green (baseline 814 pass, 0 fail) plus new `text` tests.
- [ ] 3.3 `bash scripts/lint-path-mediation.sh` clean.
