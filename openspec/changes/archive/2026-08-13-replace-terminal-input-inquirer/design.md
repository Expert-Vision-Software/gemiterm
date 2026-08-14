## Context

`src/cli/utils/prompts.ts` is the single facade over `@inquirer/prompts`. `confirm` and `select` already delegate to `inquirerConfirm`/`inquirerSelect` with the shared `theme` and `{ signal: getAbortSignal() }`. `text` is the lone hand-rolled prompt: it opens raw mode on `process.stdin`, decodes bytes, and renders a custom `? <message> <buffer>` line.

## Goals / Non-Goals

Goals: replace the raw-byte `text` loop with `@inquirer/input`; preserve the exported signature (`text(opts: TextOptions): Promise<string>`), the TTY gate, the shared theme, and cancellation mapping.

Non-goals: changing `confirm`/`select`/`browser`, changing `TextOptions`, adding new prompt types.

## Decisions

### 1. Implementation

```ts
import { input as inquirerInput } from "@inquirer/prompts";

export async function text(opts: TextOptions): Promise<string> {
  requireTty(`gemiterm new "Your message"`);
  try {
    return await inquirerInput(
      {
        message: opts.message,
        default: opts.default,
        theme,
        validate: opts.validate,
      },
      { signal: getAbortSignal() },
    );
  } catch (error) {
    mapCancellation(error);
  }
}
```

`@inquirer/input`'s `validate` accepts `(value: string) => boolean | string | Promise<boolean | string>`, which matches `TextOptions.validate`. `default` and `validate` are optional and passed through only as supplied.

### 2. Rendering

The shared `theme` (`makeTheme({ prefix, style.error, style.keysHelpTip, ... })`) is passed to `inquirerInput`. Input answer/default styling falls back to @inquirer defaults where the shared theme does not define a key. Validation errors render via `theme.style.error`, keeping inline validation consistent with `confirm`/`select`.

### 3. Cancellation

`@inquirer/input` rejects with `AbortPromptError` when the shared `signal` aborts and with `ExitPromptError` on Ctrl-C; `mapCancellation` converts both to `CancellationError`, matching the current contract.

## Risks

- The old hand-rolled renderer displayed the default value inline as dim text and cleared the line differently; the new renderer uses @inquirer's own rendering. This is a cosmetic difference in interactive mode only and does not affect non-interactive output. No test asserts the exact interactive rendering bytes.
- `@inquirer/testing` (devDependency) is used to unit-test the wrapper so the change is covered without a real TTY.

## Files

- Edit: `src/cli/utils/prompts.ts`.
- Edit: `tests/cli/utils/prompts.test.ts` (add `@inquirer/testing`-backed `text` tests).
