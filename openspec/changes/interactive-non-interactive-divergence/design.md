## Context

The GemiTerm CLI dispatches almost every Gemini RPC through a single seam — the `Mediator` (`src/core/mediator.ts`) — which routes typed queries and commands to handlers in `src/core/{query-handlers,command-handlers}.ts`. Two flows break the rule:

1. **`ContinueCommand.startInteractive`** pre-fetches via `FETCH_CHAT` to print the last model message before opening the REPL. When the SDK `readChat` response omits `lastModelTurn.rid`, `GeminiClientService.fetchChat` (`src/services/gemini-client-wrapper.ts:263-286`) silently skips the `chatMetadata.save(...)` call. The subsequent `SEND_MESSAGE` from the REPL falls back to `buildSession(conversationId)` (`gemini-client-wrapper.ts:310-343`) — `session.cid = cid` with no `rid/rcid/ctx` — and the upstream `gemini-reverse` server treats the input as a fresh prompt, returning a brand-new `cid`. The non-interactive `gemiterm continue <cid> <msg>` path doesn't pre-fetch, so it benefits from disk-cached metadata (from a prior process) or saves it from its own first response. The interactive path is structurally broken. ✅ Fixed in `commit 2d9fc76` by dropping `printLastMessage` outright.

2. **`AuthCommand`** is the only command in the registry that bypasses the mediator entirely. It composes `PlaywrightCliDriver`, `CookieMonitor`, `AuthService`, `CookieStorage`, `CookieStorageService`, and `ProfileManager` directly (`src/cli/commands/auth-command.ts:45-55`). The interactive profile menu (`showProfileMenu`, lines 309-404) reads `profileManager.getStatus` and calls `authService.authenticate/renew` directly. There is no non-interactive `auth` command to compare against, so the divergence is latent — but the `AuthenticateCommandHandler` registered at `src/cli/index.ts:126` is wired with `null as any` and never dispatched, meaning the entire auth profile-management surface is held together by hand-composed services and untested structurally.

The user's instruction: every interactive flow should leverage the mediator handlers for all core logic. The fix is structural: route interactive flows through the canonical dispatch seam so interactive and non-interactive cannot diverge in the future.

## Goals / Non-Goals

**Goals:**

- For every command that has both interactive and non-interactive modes, the interactive mode dispatches through the same handler as the non-interactive mode with a byte-identical payload.
- For every command that exists only as an interactive flow (today: `auth`), the interactive flow dispatches through a real handler that is wired into the mediator — even if no public non-interactive command invokes it.
- A single parity test harness locks interactive = non-interactive across every command that has both modes.

**Non-Goals:**

- Pulling metadata threading out of `GeminiClientService` into a new `MessageService` (Shape (b) from the investigation). That would be a big-bang refactor that duplicates the metadata contract in two places. The mediator-routing refactor (Shape (a)) is sufficient.
- Fixing the `commandClientService.profileHasConversation(name, id)` factory-wiring bug. Already in scope of the open `profile-aware-factory-wiring` change; one-line follow-up there.
- Changing the public CLI surface. No new flags, no renamed commands, no deprecated paths.
- Implementing the `summarize` command or other bulk-action additions in the open `chat-list-bulk-actions` change.

## Decisions

### Decision 1: Shape (a) — all interactive flows route through the mediator

The mediator becomes the single dispatch seam. The interactive layer is a thin TTY wrapper that prompts for input, calls `mediator.send(...)`, and renders the result. No service is composed directly by any interactive code.

**Alternatives considered:**

- **(b) Shared service layer** (`MessageService.send` + `ChatSessionService.start`). Larger blast radius because it duplicates metadata threading. Cannot land piecemeal. **Rejected.**
- **(c) Adapter pattern** (synchronous-look-alike facade over the mediator). Cosmetic; doesn't fix `printLastMessage`, `AuthCommand`, or `NewCommand` REPL closure bypass. **Rejected.**

**Rationale for (a):** only shape that fixes the divergence structurally (not by re-asserting a contract through tests); only shape that converts `AuthCommand`'s bypass into a first-class concern; only shape that is incremental (three commits, each independently shippable).

### Decision 2: Drop `printLastMessage` entirely (not "fix it")

The pre-fetch's UX value (showing the last model message) is dominated by its failure mode (silently corrupting metadata persistence). Drop it. Users can `gemiterm fetch <cid>` to see the last message; the REPL will start with a clean blank context, which matches the non-interactive path's behavior on first send.

**Alternative considered:** make `printLastMessage` defensive-persist metadata even when `lastModelTurn.rid` is absent. Rejected — the non-interactive path has no such fallback; matching the non-interactive path means not pre-fetching at all. ✅ Landed in `commit 2d9fc76`.

### Decision 3: `AuthenticateCommandHandler` is a real handler with constructor-injected `IProfileService`

`AuthenticateCommandHandler` is currently registered with `null as any` (`src/cli/index.ts:126`). Replace with a real instance whose `handle` calls `IProfileService.authenticate(profileName, options)`. The `IProfileService` interface (declared at `src/core/command-handlers.ts:85-90`) needs the five new methods:

```ts
interface IProfileService {
  authenticate(profileName: string, options?: { renew?: boolean }): Promise<void>;
  deleteProfile(profileName: string): Promise<void>;
  renameProfile(oldName: string, newName: string): Promise<void>;
  setDefaultProfile(profileName: string): Promise<void>;
  listProfileStatuses(): ProfileStatus[];
  listProfiles(): string[];
}
```

The concrete `ProfileService` is a thin adapter wrapping `AuthService` + `ProfileManager`. It owns the lifecycle of `PlaywrightCliDriver` / `CookieMonitor` (passed via constructor), exactly as `AuthCommand` does today.

**Rationale:** this is the cleanest seam between the mediator and the services. Each handler gets a single `IProfileService` it can call; the auth-related command handlers (`AuthenticateCommandHandler`, `DeleteProfileCommandHandler`, `RenameProfileCommandHandler`, `SetDefaultProfileCommandHandler`) all consume it. The `null as any` placeholder is replaced with a real instance.

### Decision 4: `AuthCommand`'s `showProfileMenu` dispatches commands, not composes services

The menu today reads `profileManager.getStatus`, calls `authService.authenticate/renew` inline, and never goes through the mediator. Replace each menu option with the corresponding mediator dispatch:

| Menu option | Today | After |
| --- | --- | --- |
| `A` Add new profile | `authService.authenticate(newName)` | `mediator.send({ type: COMMAND_TYPES.AUTHENTICATE, payload: { profileName: newName, create: true } })` |
| `D` Delete profile | `profileManager.delete(name)` | `mediator.send({ type: COMMAND_TYPES.DELETE_PROFILE, payload: { profileName: name } })` |
| `S` Set default | `profileManager.setDefault(name)` + `setDefaultProfileName(name)` | `mediator.send({ type: COMMAND_TYPES.SET_DEFAULT_PROFILE, payload: { profileName: name } })` |
| `R` Rename profile | `profileManager.rename(old, new)` + `authService.authenticate(new)` | `mediator.send({ type: COMMAND_TYPES.RENAME_PROFILE, payload: { oldName, newName } })` then `AUTHENTICATE` for the new name |
| `E` Renew session | `authService.renew(name)` | `mediator.send({ type: COMMAND_TYPES.AUTHENTICATE, payload: { profileName: name, renew: true } })` |

The argv parsing in `AuthCommand` (`parseFlags`, lines 121-172) stays — but each branch dispatches the corresponding command instead of composing services.

**Rationale:** every menu option becomes "the same code path the non-interactive `auth` would invoke, if there were one". The interactive wrapper becomes a TTY loop.

### Decision 5: Parity test harness

Add `tests/cli/utils/parity-harness.ts` (or inline per test file) that wires a real `Mediator` + real `SendMessageCommandHandler` + spy `clientService` + in-memory `ChatMetadataStorage`, and exposes:

```ts
async function runInteractiveAndAssertParity(
  commandName: string,
  args: string[],
  replResponses: string[],
): Promise<void>;
```

The harness invokes `command.execute(args, context)` (which routes through the REPL when the message arg is absent), feeds `replResponses` into the prompt facade, and asserts the dispatched `SEND_MESSAGE` payloads match the non-interactive `execute(argsWithMessage, context)` payload for the same `args` minus the repl responses. One test per affected command (`continue`, `new`).

### Decision 6: Spec drift fix for `chat-list-browser`

The action menu requirement at `openspec/specs/chat-list-browser/spec.md:240-253` enumerates seven options; the code has eight (`continue` is missing). Add an `ADDED Requirements` block for `continue`. This change is bundled because the spec gap is small and the parity refactor will assert the dispatch contract that the spec should describe.

## Risks / Trade-offs

- **[Risk] `AuthCommand` refactor has the largest blast radius.** ~440 lines become ~80 (argv parser + menu) plus a new ~150-line `ProfileService` adapter. → **Mitigation:** land in a dedicated commit; cover with the existing `auth-command.test.ts` regression surface plus a new mediator-dispatch parity test. The refactor is a series of mechanical replacements (each menu option's service call → mediator dispatch), no behavior change.

- **[Risk] `IProfileService` interface growth.** Six new methods when today `AuthCommand` composes five services inline. → **Mitigation:** the interface is a pure subset of the methods `AuthCommand` already calls; no new semantics. Future commands (e.g., `profile list` standalone) reuse the same interface.

- **[Risk] `reauth.ts` move into `AuthenticateCommandHandler.handle`.** The reauth flow is currently invoked from `getGeminiClient`'s catch (`src/cli/index.ts:96`); making it part of `AuthenticateCommandHandler.handle` means the handler decides whether to prompt-and-reauth vs throw. → **Mitigation:** the handler signature gains an `interactive: boolean` flag (set by `AuthCommand`'s menu, false for any non-interactive mediator dispatch). When `interactive=false`, the handler throws on `AuthenticationError` and the existing reauth flow in `getGeminiClient`'s catch fires as today. When `interactive=true`, the handler runs the prompt-and-reauth loop inline. This preserves the existing non-interactive behavior.

- **[Trade-off] Public CLI surface is unchanged** but the internal mediator-dispatch topology grows (9 → 12 registered handlers). No user-visible effect.

- **[Trade-off] Interactive menu's per-option dispatch adds a microsecond-scale in-process round-trip** through the mediator. Negligible.

## Migration Plan

No data migration. No config migration. No CLI surface change. The refactor is internal-only: each commit lands and tests pass. Rollback is per-commit (git revert) — no compatibility shims needed because the public contract doesn't change.

## Open Questions

None blocking. The four commits below are ordered by dependency; each is independently shippable.