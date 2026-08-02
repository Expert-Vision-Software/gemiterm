## ADDED Requirements

### Requirement: CLI intercepts AuthenticationError and prompts for reauth
When the `getGeminiClient()` factory in `src/cli/index.ts` encounters an `AuthenticationError` (either from `loadCookiesForApi` throwing or from `ProfileAuthManager.ensureAuthenticated` throwing), the factory MUST catch the error and, before propagating it, attempt to present a re-authentication prompt. The prompt MUST use the `confirm` function from the prompt facade (`src/cli/utils/prompts.ts`). The prompt message MUST contain the substring `Session for profile` and the profile name, and MUST contain the substring `Would you like to launch browser to re-authenticate?`.

#### Scenario: User confirms reauth, browser launches, and operation retries
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError` for profile `"default"`, the user answers `y` to the confirm prompt, and the headed auth flow succeeds
- **THEN** the factory calls `authService.authenticate("default")` (or equivalent auth flow), saves the resulting cookies, calls `profileManager.loadCookiesForApi("default")` again, constructs a new `GeminiClientService` with fresh cookie values, and returns it
- **AND** the original caller (command handler) receives a working client and proceeds with the operation

#### Scenario: User declines reauth, error propagates
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError` and the user answers `n` (or any non-y response) to the confirm prompt
- **THEN** the factory re-throws the original `AuthenticationError`
- **AND** the CLI error handler catches it and prints the error message, exiting with code 1

#### Scenario: Non-TTY mode skips prompt and propagates error
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError` and `process.stdin.isTTY` is `false`
- **THEN** the `confirm` call throws `NonInteractiveError`, which the factory catches and re-throws the original `AuthenticationError`
- **AND** the behavior matches today's error path (error message printed, exit code 1)

#### Scenario: Reauth retry fails, error propagates
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError`, the user confirms reauth, the auth flow succeeds, but the retry `loadCookiesForApi` still throws (e.g., cookies not saved correctly)
- **THEN** the factory throws the second `AuthenticationError` without presenting another prompt (single retry only)
- **AND** the CLI error handler catches it and exits with code 1

### Requirement: Reauth prompt respects --profile flag
When the CLI was invoked with `--profile/-p <name>`, the reauth prompt and the subsequent auth flow MUST target the specified profile, not the default profile. The confirm message MUST include the explicitly-specified profile name.

#### Scenario: Reauth prompt with explicit profile
- **WHEN** `getGeminiClient()` is called with `profileName` set to `"work"` (via `--profile work`) and encounters an `AuthenticationError`
- **THEN** the confirm prompt message contains `"work"` and the auth flow targets the `"work"` profile

### Requirement: Reauth prompt uses prompt facade
The reauth prompt MUST use the `confirm()` function exported from `src/cli/utils/prompts.ts`. The prompt MUST NOT import from `@inquirer/prompts` directly. On `CancellationError` (user presses Ctrl+C during prompt), the factory MUST re-throw the original `AuthenticationError` (not the cancellation).

#### Scenario: Ctrl+C during reauth prompt propagates auth error
- **WHEN** the user presses Ctrl+C while the reauth confirm prompt is displayed
- **THEN** the `confirm()` call throws `CancellationError`, the factory catches it and re-throws the original `AuthenticationError`
- **AND** the CLI exits with the authentication error message, not a cancellation message
