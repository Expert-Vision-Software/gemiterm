## Why

`src/cli/index.ts` contains the `getGeminiClient` factory (caches clients, runs reauth-retry, wires `--profile`) which has zero direct tests. `tests/cli/index.test.ts` exists but tests `reauth.ts`, not the factory. The "wrong profile's client" bug (`profile-aware-factory-wiring`) hides in this factory — when `ListChatsQueryHandler` is wired with `getGeminiClient()` (no profile arg), every command authenticates the default profile regardless of which profile was requested.

## What Changes

- New `tests/cli/get-gemini-client.test.ts` covering:
  - **Profile forwarding in query handler:** `ListChatsQueryHandler` with profile field forwards to `IGeminiClientService.forProfile(name)`
  - **Profile forwarding in command handler:** `DeleteConversationCommandHandler` with profileName forwards to `forProfile(name)`
  - **AuthenticationError surface:** the `getGeminiClient` factory pattern (as exercised through `ListChatsQueryHandler`) passes the error to the reauth prompt path
  - **Multi-profile independence:** handlers for different profiles get different client scopes
- OpenSpec delta to `openspec/specs/cli/spec.md`: new requirement on the factory contract.

## Capabilities

### Modified Capabilities

- `cli` — add a `Requirement: Command handlers forward profile name to client factory` requirement that asserts profile-aware routing.

## Impact

- Code touched: `tests/cli/get-gemini-client.test.ts` (new).
- No production code changes.
- Test count: +1 file, ~6-8 tests.
