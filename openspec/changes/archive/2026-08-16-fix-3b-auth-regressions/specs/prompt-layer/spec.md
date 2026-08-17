# Delta: prompt-layer (fix-3b-auth-regressions)

Adds a no-re-export rule to the prompt facade discipline. The existing TTY gate, theme, cancellation-mapping, and single-importer requirements are unchanged.

## ADDED Requirements

### Requirement: Prompt facade symbols SHALL NOT be re-exported by consumers
Modules that consume the prompt facade (`src/cli/utils/prompts.ts`) SHALL import its symbols (`text`, `confirm`, `select`, `browser`, `CancellationError`, `NonInteractiveError`) directly from the facade module. No consumer module SHALL re-export facade symbols under its own name; consumer modules are consumers of the facade, not re-publishers of it. Dependency-injection seams that pass facade symbols as tokens (e.g. the REPL's `InteractiveLoopDeps`) SHALL receive symbols imported from `src/cli/utils/prompts.ts`, not from another consumer.

#### Scenario: REPL module does not re-export facade symbols
- **WHEN** `src/cli/utils/interactive-prompt.ts` is read
- **THEN** it contains no `export` of `text`, `confirm`, `select`, `browser`, `CancellationError`, or `NonInteractiveError`

#### Scenario: DI consumers import from the facade directly
- **WHEN** a module passes `text` or `CancellationError` into an injection seam (e.g. `chat-session.ts` wiring `InteractiveLoopDeps`)
- **THEN** those symbols are imported from `src/cli/utils/prompts.ts`, not from `src/cli/utils/interactive-prompt.ts`
