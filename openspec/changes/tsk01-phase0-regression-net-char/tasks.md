## 1. Full-stack fixture

- [ ] 1.1 Create `tests/helpers/full-stack-fixture.ts` exporting `buildFullStack(options)`
- [ ] 1.2 Fixture assembles real `CookieStorage`, `ProfileManager`, `CookieStorageService`, `ProfileAuthManager`
- [ ] 1.3 Fixture includes cookie-aware fake `IGeminiClientService` (listChats returns chats iff companions present)
- [ ] 1.4 Fixture includes `teardown()` function that cleans tmpdir and resets env

## 2. Characterization tests

- [ ] 2.1 Full jar round-trip: ensureAuthenticated → loadAllCookiesForProfile (companions present) → listChats returns ≥1
- [ ] 2.2 Trimmed jar (phantom-auth): seed only PSID+PSIDTS → models succeeds → listChats returns empty
- [ ] 2.3 Profile routing: seed two profiles → ensureAuthenticated("profileA") → cookies match profileA
- [ ] 2.4 Jar completeness after ensureAuthenticated: companions preserved (not corrupted)
- [ ] 2.5 Conversation threading: sendMessage(cid) → verify fetchChat returns the same turn

## 3. OpenSpec delta

- [ ] 3.1 Add Phase-0 regression net requirement to `specs/phantom-auth-detection/spec.md`
- [ ] 3.2 Run `bun run typecheck` and confirm clean
- [ ] 3.3 Run `bun test tests/services/regression-net.test.ts` and confirm the tests exercise the regression net
- [ ] 3.4 Commit

## 4. Verification

- [ ] 4.1 `bun run typecheck` — clean
- [ ] 4.2 `bun test tests/services/regression-net.test.ts` — all tests run
- [ ] 4.3 `bun test` full suite — existing tests unaffected
