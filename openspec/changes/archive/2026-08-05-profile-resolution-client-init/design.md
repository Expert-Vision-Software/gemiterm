## Context

The CLI builds two service objects (`clientService: IGeminiClientQueryService`, `commandClientService: IGeminiClientService`) that handlers use to reach Gemini. Both expose `forProfile(name)`. The original implementation in `src/cli/index.ts` (now behavior-preservingly extracted to `src/cli/client-services.ts`):

```ts
forProfile(name) {
  const c = geminiClient;          // module singleton
  if (!c) throw new AuthenticationError();
  return c.forProfile(name);
}
```

The singleton `geminiClient` is populated only by `getGeminiClient()` (called by `listChats`/`fetchChat`/`deleteChat`/etc. via the other methods on the same service objects). So `forProfile` works only if some other method already ran. When `fetch`/`export`/`continue`/`delete` is the **first** operation in a process, the singleton is `null` and `forProfile` throws `AuthenticationError("Not authenticated. Please run 'gemiterm login' first.")`.

Two manifestation paths (both reproduced in `tests/cli/client-services.test.ts`):
1. **Explicit `--profile`**: `FetchChatQueryHandler` calls `this.geminiClient.forProfile(profileName)` directly — throws on first call.
2. **Auto-discovery**: `findProfileForConversation` returns the owner profile, then `commandClientService.forProfile(owner)` throws on the next call.

The factory's other methods (`listChats`, `fetchChat`, …) already do `await getGeminiClient()` first, which is why `list`/`new`/`models` work. `forProfile` is the lone method that reads the raw singleton instead of ensuring the client.

`getGeminiClient(profileName?)` runs `profileAuthManager.ensureAuthenticated(targetProfile)` and, on `AuthenticationError`, presents the reauth prompt (`auth` spec, `:536+`). So routing `forProfile` through `getGeminiClient` also gives profile-scoped commands the reauth UX for free.

## Goals / Non-Goals

**Goals**
- `forProfile(name)` returns a usable profile client on the first call in a process, for both the explicit-`--profile` and auto-discovery paths.
- `forProfile` participates in the existing reauth prompt flow (because it goes through `getGeminiClient`).

**Non-Goals**
- Eager initialization of the singleton during mediator setup (considered, rejected — see Decisions).
- Changing `findProfileForConversation`'s contract.
- Caching profile-scoped clients across calls.

## Decisions

### Decision 1: Make `forProfile` async and route it through `getGeminiClient` (chosen fix)

```ts
async forProfile(name: string) {
  const c = await getGeminiClient(name);
  return c.forProfile(name);
}
```

**Rationale**: `getGeminiClient` is the canonical "give me a working client for this profile" path — it ensures auth and offers reauth. `forProfile` was the only method bypassing it. Routing through it makes `forProfile` consistent with the sibling methods and fixes both manifestation paths with one change. This is the user-confirmed option.

**Alternative considered — Eager singleton init in `setupMediator`**: initialize `geminiClient` for the default profile during mediator setup so it is never null. Rejected because: (a) it only covers the default profile — `--profile X` for a non-default profile would still hit a null-or-wrong singleton unless we also pre-initialize every profile (expensive, and runs `ensureAuthenticated` for profiles the user never touched); (b) it preserves a sync `forProfile` signature but at the cost of surprising startup auth probes; (c) the async signature is the honest expression of "this may need to authenticate."

### Decision 2: Keep the `createClientServices` extraction

The factory lives in `src/cli/client-services.ts` (extracted as behavior-preserving scaffolding to create a testable seam). `cli/index.ts` passes `getGeminiClient` and `() => geminiClient` (the cached-singleton accessor). After the fix, the `getCachedClient` accessor is no longer needed by `forProfile` (it uses `getGeminiClient` directly); it is removed to avoid dead code, and `cli/index.ts` stops passing it.

### Decision 3: Update the interfaces and concrete class together

`IGeminiClientService.forProfile` and `IGeminiClientQueryService.forProfile` return `Promise<Self>`. `GeminiClientService.forProfile` becomes `async forProfile(...)` (its body is already sync-safe; wrapping in `async` is the only change). TypeScript flags every un-awaited call site at compile time, so the audit is mechanical and verified by `bun run typecheck`.

## Risks / Trade-offs

- **[Missed await] A call site that forgets to await would chain off a `Promise`** → TypeScript `--noEmit` catches this on the typed interface (a `Promise` lacks the chained method). The audit + typecheck is the guard.
- **[Reauth during forProfile] The first `forProfile` in a non-TTY process whose session expired now surfaces the reauth path** → identical to today's behavior for `list`/`fetch` via the other methods (they already go through `getGeminiClient`); `forProfile` merely joins them. No new non-TTY risk.
- **[Double init] `forProfile(name)` then a sibling method both call `getGeminiClient`** → `getGeminiClient` caches the singleton and returns it when the profile matches (`cli/index.ts:81`), so the second call is a cache hit. No duplicate auth.
- **[Test doubles] Stub `forProfile() { return this }` must become async** → straightforward; the `gimme` helper and inline stubs return `Promise.resolve(this)` / `async forProfile() { return this }`.

## Migration Plan

Single-PR, internal interface break (no public API change — the CLI is the surface). No data/config migration. Order: (1) change interfaces + concrete `forProfile` to async, (2) fix `createClientServices.forProfile` to await `getGeminiClient`, (3) green the red test, (4) fix every call site flagged by `typecheck`, (5) update test doubles, (6) full suite + typecheck.

## Open Questions

None. (The extraction is already in place on the working branch as scaffolding; this change formalizes it.)
