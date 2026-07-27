# Tasks: Persist refreshed Gemini cookies back to profile storage

Prerequisite: `upgrade-gemini-reverse-2-1-0` must be merged first (this
change adds call sites inside the wrapper that change rewrites).
Design reference: `design.md` (decisions D1–D6).

## 1. CookieStorageService save seam (D1)

- [x] 1.1 Re-read `tests/services/cookie-storage-service.test.ts` (sensitive
  area, per AGENTS.md) before touching the service.
- [x] 1.2 Add `saveCookiesForProfile(profileName: string, cookies: Cookie[]): void`
  to `src/services/cookie-storage-service.ts`, delegating to the composed
  `CookieStorage.save`. No changes to existing methods. (Also added a thin
  `loadAllCookiesForProfile(profileName): Cookie[]` delegation — needed by the
  D3 merge step to read the stored list for metadata preservation; the wrapper
  stays at the service layer and never touches `CookieStorage` directly.)
- [x] 1.3 Add a delegation unit test in
  `tests/services/cookie-storage-service.test.ts` (spy storage asserts
  profile name + cookie list passed through).

## 2. Wrapper persistence (D2–D5)

- [x] 2.1 In `src/services/gemini-client-wrapper.ts`, record the constructed
  `secure_1psid`/`secure_1psidts` values as the baseline for change
  detection.
- [x] 2.2 Add private `persistRefreshedCookies()`: guards (D5), diff against
  baseline, merge into the profile's stored `Cookie[]` preserving each
  entry's metadata and setting `expires = now + 7 days` (D3), save via
  `cookieStorageService.saveCookiesForProfile`, update the baseline after a
  successful write, and wrap everything so failures log at debug and never
  throw (D4).
- [x] 2.3 Call `persistRefreshedCookies()` at the end of `init()` and at the
  end of each public method's success path (`listChats`, `fetchChat`,
  `sendMessage`, `startNewChat`, `deleteChat`, `listModels`) — after the
  translated result is produced, never in the catch path.

## 3. Wrapper tests (D6)

- [x] 3.1 Extend the `gemini-reverse` module mock so client instances expose
  a mutable `cookies` dict the test can mutate after construction.
  (Already present in the existing mock — verified and reused as-is.)
- [x] 3.2 Add the four spec scenarios: (a) refreshed `__Secure-1PSID` →
  stored list saved with new value, original metadata intact, `expires`
  refreshed, and a second operation does not re-save; (b) unchanged jar →
  no save; (c) no `profileName` → no save regardless of jar; (d) save
  throws → operation result returned normally.

## 4. Verification

- [x] 4.1 `bun test` baseline intact (756 pass / 0 fail — re-verified; the
  657 figure was stale, recent commits had raised the count),
  `bun run typecheck` clean, `bun run lint:mediation` (bash form) — the bash
  script could not execute in this session's WSL relay (`/bin/bash` missing),
  so compliance was verified by replicating its exact `grep` (only the three
  exempt files import `node:fs/path/os`; the two changed source files add none).
- [ ] 4.2 Manual live check with `--verbose`: after a fresh `auth`, run
  `list` twice and confirm (via debug logging) the refreshed-cookie persist
  path runs and the profile's cookie JSON on disk is updated only when the
  jar actually changed. (Deferred — requires a live Google auth.)
- [x] 4.3 `CHANGELOG.md` entry. (Commit pending explicit user request; will be
  a single conventional commit `feat(auth): persist refreshed Gemini cookies
  to profile storage`.)
