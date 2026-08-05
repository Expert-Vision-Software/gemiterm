## ADDED Requirements

### Requirement: CLI client-service forProfile lazily initializes the profile client

The `forProfile(name)` methods on the CLI's `clientService` (`IGeminiClientQueryService`) and `commandClientService` (`IGeminiClientService`), built by `createClientServices` in `src/cli/client-services.ts`, MUST be async and MUST obtain the profile client via the `getGeminiClient(name)` factory rather than reading a cached singleton. They MUST return a `Promise` that resolves to the profile-scoped client. They MUST NOT throw an authentication error solely because no prior call has populated a cached client — the first `forProfile(name)` call in a process MUST succeed (subject to the normal `ensureAuthenticated` / reauth flow inside `getGeminiClient`). The `forProfile` members of `IGeminiClientService` and `IGeminiClientQueryService`, and the concrete `GeminiClientService.forProfile` in `src/services/gemini-client-wrapper.ts`, MUST return `Promise<Self>`.

#### Scenario: forProfile succeeds as the first operation in a process
- **WHEN** `await clientService.forProfile("work")` is called and no prior data call has cached a client in this process
- **THEN** the method resolves to a profile-scoped client for `"work"` (it does NOT throw "Not authenticated. Please run 'gemiterm login' first.")

#### Scenario: forProfile routes through getGeminiClient
- **WHEN** `await clientService.forProfile("work")` is called
- **THEN** `getGeminiClient` is invoked with `"work"`, so `ensureAuthenticated("work")` and the reauth prompt path apply to the profile-scoped operation

#### Scenario: commandClientService forProfile succeeds on first call
- **WHEN** `await commandClientService.forProfile("work")` is called as the first data operation in a process
- **THEN** the method resolves to a profile-scoped client and does NOT throw

#### Scenario: forProfile is awaitable on the typed interfaces
- **WHEN** a handler typed against `IGeminiClientQueryService` or `IGeminiClientService` calls `forProfile(name)`
- **THEN** the call returns a `Promise` that must be awaited (the interface signature is `forProfile(name: string): Promise<Self>`)
