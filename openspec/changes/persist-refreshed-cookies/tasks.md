# Tasks: Persist refreshed Gemini cookies back to profile storage

Prerequisite: `upgrade-gemini-reverse-2-1-0` must be merged first (this
change adds call sites inside the wrapper that change rewrites).
Design reference: `design.md` (decisions D1–D6).

## 1. CookieStorageService save seam (D1)

- [ ] 1.1 Re-read `tests/services/cookie-storage-service.test.ts` (sensitive
  area, per AGENTS.md) before touching the service.
- [ ] 1.2 Add `saveCookiesForProfile(profileName: string, cookies: Cookie[]): void`
  to `src/services/cookie-storage-service.ts`, delegating to the composed
  `CookieStorage.save`. No changes to existing methods.
- [ ] 1.3 Add a delegation unit test in
  `tests/services/cookie-storage-service.test.ts` (spy storage asserts
  profile name + cookie list passed through).

## 2. Wrapper persistence (D2–D5)

- [ ] 2.1 In `src/services/gemini-client-wrapper.ts`, record the constructed
  `secure_1psid`/`secure_1psidts` values as the baseline for change
  detection.
- [ ] 2.2 Add private `persistRefreshedCookies()`: guards (D5), diff against
  baseline, merge into the profile's stored `Cookie[]` preserving each
  entry's metadata and setting `expires = now + 7 days` (D3), save via
  `cookieStorageService.saveCookiesForProfile`, update the baseline after a
  successful write, and wrap everything so failures log at debug and never
  throw (D4).
- [ ] 2.3 Call `persistRefreshedCookies()` at the end of `init()` and at the
  end of each public method's success path (`listChats`, `fetchChat`,
  `sendMessage`, `startNewChat`, `deleteChat`, `listModels`) — after the
  translated result is produced, never in the catch path.

## 3. Wrapper tests (D6)

- [ ] 3.1 Extend the `gemini-reverse` module mock so client instances expose
  a mutable `cookies` dict the test can mutate after construction.
- [ ] 3.2 Add the four spec scenarios: (a) refreshed `__Secure-1PSID` →
  stored list saved with new value, original metadata intact, `expires`
  refreshed, and a second operation does not re-save; (b) unchanged jar →
  no save; (c) no `profileName` → no save regardless of jar; (d) save
  throws → operation result returned normally.

## 4. Verification

- [ ] 4.1 `bun test` baseline intact (657 pass / 0 fail at authoring time —
  re-verify), `bun run typecheck` clean, `bun run lint:mediation` (bash
  form) clean.
- [ ] 4.2 Manual live check with `--verbose`: after a fresh `auth`, run
  `list` twice and confirm (via debug logging) the refreshed-cookie persist
  path runs and the profile's cookie JSON on disk is updated only when the
  jar actually changed.
- [ ] 4.3 `CHANGELOG.md` entry; commit as a single conventional commit
  (e.g. `feat(auth): persist refreshed Gemini cookies to profile storage`).
