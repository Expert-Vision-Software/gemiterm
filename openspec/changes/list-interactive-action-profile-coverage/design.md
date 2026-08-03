## Context

The `executeAction` method in `src/cli/commands/list-command.ts` dispatches user-selected actions from the interactive `list -i` browser to the appropriate sub-commands (`fetch`, `export`, `continue`, `delete`). Commit `807a7ea` added `const profileArgs = chat.profile ? ["--profile", chat.profile] : []` and spreads it into all five dispatch calls. The existing test suite covers `view` → `fetch` with profile forwarding, but the four remaining actions (`export-markdown`, `export-json`, `continue`, `delete`) are untested in their profile-forwarding variant.

## Goals / Non-Goals

**Goals:**
- Add regression tests for the `export-markdown`, `export-json`, `continue`, and `delete` interactive action paths asserting correct `--profile` argv forwarding
- Follow the established test pattern in `tests/cli/list-command.test.ts`

**Non-Goals:**
- No production code changes
- No new test infrastructure or helpers
- No spec changes — this is a pure test coverage improvement

## Decisions

1. **One test per action** — Rather than a cartesian-product matrix, add one test per action that exercises profile forwarding. This mirrors the existing `view` test and is sufficient to catch regressions.

2. **Reuse existing mock plumbing** — The `describe("action menu (single-pick dispatch)")` block already stubs `deleteExecute`, `exportExecute`, `fetchExecute`, and `continueExecute`. Tests for `export-markdown`/`export-json` reuse `exportExecute`; `continue` reuses `continueExecute`; `delete` already has a test but without `--profile`.

3. **Minimal chat fixture** — Each test creates a single chat with `profile: "<name>"` and asserts the exact argv shape. No need for multi-profile fixtures.

## Risks / Trade-offs

- **Risk**: The new tests are low-complexity unit tests with mocked dependencies — no risk of flakiness or external dependencies.
- **Trade-off**: Testing only the argv shape (not the actual sub-command behaviour) — this is intentional and consistent with the existing test suite's approach.

## Open Questions

- None.
