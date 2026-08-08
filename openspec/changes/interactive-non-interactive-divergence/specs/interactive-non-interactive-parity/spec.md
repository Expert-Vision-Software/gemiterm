## Purpose

The cross-cutting property that interactive CLI flows dispatch through the mediator and produce byte-identical handler payloads to their non-interactive counterparts. This capability exists to make the "interactive = non-interactive" property structurally true, not empirically tested per command.

## ADDED Requirements

### Requirement: Interactive flows route through the mediator

Every interactive CLI flow that issues a Gemini RPC or a profile-mutating action MUST dispatch through the `Mediator` (`src/core/mediator.ts`) using the same query/command types and payload shapes as the canonical non-interactive handler. Interactive code MUST NOT compose services directly (e.g., `AuthService`, `ProfileManager`, `GeminiClientService`, `CookieMonitor`, `PlaywrightCliDriver`) outside of mediator handler construction.

#### Scenario: Chat REPL message handler is built from the canonical dispatch seam

- **WHEN** a command opens an interactive REPL (e.g., `gemiterm continue <cid>` without a positional message, `gemiterm new "Hi"` followed by REPL turns)
- **THEN** the REPL's `messageHandler` MUST be constructed by the same handler that the non-interactive path uses (`SendMessageCommandHandler.handle` for `continue` REPL turns; `StartNewChatCommandHandler.handle` for `new` REPL turns)
- **AND** the dispatched payload MUST be byte-identical to the payload the non-interactive command would produce for the same conversation and message
- **AND** no service is composed directly inside the REPL callback

#### Scenario: Chat-list-browser action menu dispatches via CommandRegistry

- **WHEN** the user picks an action in `gemiterm list -i`
- **THEN** the action handler MUST resolve the corresponding `CliCommand` via `CommandRegistry.getHandler(name)` and invoke `.execute(args, context)` with the original context
- **AND** the dispatched args MUST include `--profile <name>` when the chat has an owning profile (forwarding contract; `chat-list-browser` capability)
- **AND** no service is composed directly inside the browser action callback

#### Scenario: AuthCommand interactive menu dispatches through the mediator

- **WHEN** the user selects an option in `AuthCommand`'s profile menu (`A`/`D`/`S`/`R`/`E`/`X`)
- **THEN** the menu MUST dispatch `AUTHENTICATE` / `DELETE_PROFILE` / `RENAME_PROFILE` / `SET_DEFAULT_PROFILE` / `RENEW_PROFILE` commands through the mediator instead of calling `AuthService.authenticate/renew`, `ProfileManager.delete/rename/setDefault`, or `setDefaultProfileName` directly
- **AND** the `AuthCommand`'s argv parser (`--add`, `--delete`, `--renew`, `--rename`, `--default`) MUST also dispatch through the mediator for the same reasons

### Requirement: Interactive = non-interactive payload equivalence

For every command that has both an interactive mode and a non-interactive mode, the `Mediator` payload dispatched by the interactive mode MUST be byte-identical to the payload dispatched by the non-interactive mode for the same logical operation.

#### Scenario: continue interactive and non-interactive produce the same SEND_MESSAGE payload

- **WHEN** a test harness invokes `gemiterm continue <cid> "hello"` (non-interactive, single send)
- **AND** the same harness invokes `gemiterm continue <cid>` (interactive, REPL) and feeds the single line `"hello"` into the prompt facade
- **THEN** the `SEND_MESSAGE` payload dispatched by the non-interactive path MUST be byte-identical to the `SEND_MESSAGE` payload dispatched by the interactive path's REPL on the first turn

#### Scenario: new interactive and non-interactive produce the same START_NEW_CHAT payload

- **WHEN** a test harness invokes `gemiterm new "Hi"` (non-interactive, single chat start)
- **AND** the same harness invokes `gemiterm new` (interactive, REPL) and feeds `"Hi"` as the first line
- **THEN** the `START_NEW_CHAT` payload dispatched by the non-interactive path MUST be byte-identical to the `START_NEW_CHAT` payload dispatched by the interactive path's REPL on the first turn

#### Scenario: Subsequent REPL turns in `new` switch to SEND_MESSAGE

- **WHEN** the user types a second line in the `gemiterm new` REPL
- **THEN** the dispatched command MUST be `SEND_MESSAGE` against the `conversationId` returned by the first turn's response
- **AND** the payload MUST be byte-identical to `gemiterm continue <cid> <message>` for the same conversation and message
- **AND** NOT another `START_NEW_CHAT` against the same `conversationId` (which would create a duplicate session)

### Requirement: AuthenticateCommandHandler is a real handler

The `AuthenticateCommandHandler` MUST be registered with the mediator with a real constructor-injected `IProfileService`, not the `null as any` placeholder used today. The handler MUST handle the `AUTHENTICATE` command for both `create` (new profile) and `renew` (existing profile) modes.

#### Scenario: AuthenticateCommandHandler dispatches to IProfileService.authenticate

- **WHEN** the mediator receives an `AUTHENTICATE` command with `payload: { profileName: "work", create: false, renew: true }`
- **THEN** the handler MUST call `IProfileService.authenticate("work", { renew: true })`
- **AND** the dispatched auth MUST reuse the cookie-monitor-based renewal flow (`AuthService.renew`), not the headed-browser `AuthService.authenticate`

#### Scenario: IProfileService is the single auth-side seam

- **WHEN** any mediator handler needs to perform a profile mutation (delete, rename, set-default) or auth action (authenticate, renew)
- **THEN** the handler MUST call the corresponding `IProfileService` method
- **AND** no handler MUST compose `AuthService`, `CookieMonitor`, `PlaywrightCliDriver`, or `ProfileManager` directly

### Requirement: Parity test harness

A test harness MUST exist that locks interactive = non-interactive equivalence for every command with both modes. The harness wires a real `Mediator` + real handlers + spy `clientService` + in-memory `ChatMetadataStorage`, and exposes a `runInteractiveAndAssertParity` helper that drives the REPL prompt facade and asserts dispatched payloads.

#### Scenario: Parity harness covers continue

- **WHEN** the parity test for `continue` runs
- **THEN** the non-interactive `gemiterm continue <cid> "hello"` invocation dispatches `SEND_MESSAGE` with payload `{"conversationId": "<cid>", "message": "hello", "profileName": "work"}`
- **AND** the interactive `gemiterm continue <cid>` invocation with one REPL line `"hello"` dispatches `SEND_MESSAGE` with the same payload
- **AND** the test fails if either dispatch is missing or the payloads diverge

#### Scenario: Parity harness covers new

- **WHEN** the parity test for `new` runs
- **THEN** the non-interactive `gemiterm new "Hi"` invocation dispatches `START_NEW_CHAT` with payload `{"message": "Hi", "profileName": "work"}`
- **AND** the interactive `gemiterm new` invocation with one REPL line `"Hi"` dispatches `START_NEW_CHAT` with the same payload
- **AND** the second-line REPL invocation dispatches `SEND_MESSAGE` against the resulting `conversationId`