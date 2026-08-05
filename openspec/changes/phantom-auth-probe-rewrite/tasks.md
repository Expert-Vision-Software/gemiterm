## 1. Replace listChats probe with models() RPC

- [ ] 1.1 Add `models` to the `IGeminiClientService` interface in `src/core/command-handlers.ts` (signature: `models(): Promise<string[]>` or void if the SDK returns no useful payload).
- [ ] 1.2 Implement `models()` on `GeminiClientService` in `src/services/gemini-client-wrapper.ts`, delegating to the gemini-web-sdk's `models` method.
- [ ] 1.3 In `src/services/profile-auth-manager.ts`, replace `this.geminiClient.forProfile(name).listChats({ limit: 1 })` with `this.geminiClient.forProfile(name).models()` in `probeServerSession`.
- [ ] 1.4 Simplify probe classification: remove the `chats.length > 0` / `profile-has-chats` / "ambiguous" branches. Success → "valid", throw → "stale". Remove the `readProfileHasChats` call.
- [ ] 1.5 Run `bun run typecheck` and confirm clean.

## 2. Remove profile-has-chats marker

- [ ] 2.1 Remove `writeProfileHasChats`, `readProfileHasChats` from `src/infrastructure/io.ts`.
- [ ] 2.2 Remove `getProfileHasChatsPath` from `src/infrastructure/path-utils.ts`.
- [ ] 2.3 Remove dead imports of the marker functions from `src/services/profile-auth-manager.ts`.
- [ ] 2.4 Run `bun run typecheck` and confirm clean.

## 3. Update gimme() test helper and phantom-auth tests

- [ ] 3.1 Add `models` stub to the `gimme()` helper in `tests/services/phantom-auth.test.ts` (signature matching the updated interface).
- [ ] 3.2 Update the four smoke tests to use `models()` instead of `listChats()` in their gimme setup. Remove `writeFileSync` calls that write the `profile-has-chats` marker.
- [ ] 3.3 Update `tests/services/profile-auth-manager.test.ts`: remove marker-file assertions, update gimme calls to include `models`.
- [ ] 3.4 Run `bun test tests/services/phantom-auth.test.ts tests/services/profile-auth-manager.test.ts` and confirm all pass including the smoke tests.
- [ ] 3.5 Run `bun test` (full suite) and confirm no regressions.

## 4. io.ts call-site fix

- [ ] 4.1 After removing `writeProfileHasChats` / `readProfileHasChats`, verify the remaining `io.ts` helpers each have at least 2 call sites (the CI gate enforces this). If any drop below 2, add test call sites.
- [ ] 4.2 Run `bun run typecheck` and confirm clean.

## 5. Spec sync and validation

- [ ] 5.1 Run `openspec validate --strict --change phantom-auth-probe-rewrite` and confirm clean.
- [ ] 5.2 Create a deferred follow-up ticket on `gemini-web-sdk` for injecting `AuthError`-on-degraded-session into the SDK itself.
- [ ] 5.3 Commit all changes.
