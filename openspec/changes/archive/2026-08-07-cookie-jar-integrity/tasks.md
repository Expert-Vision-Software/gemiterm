# Tasks: cookie-jar-integrity

> **Status: implemented.** Fix landed; full suite green (928 pass / 0 fail / 1945 expects); CHANGELOG patched. Archival (task 5.1) pending.
>
> Prior art already landed on this branch: the deterministic repro harness (`tests/services/cookie-jar-repro.test.ts`, commit `efab987`) and the two RED tests pinning the desired monitor contract (`tests/services/cookie-monitor.test.ts`, commit `7b2d55f`). These tasks green the RED tests and align the surrounding characterization.

## 1. Green the RED tests (the fix)

- [x] 1.1 In `src/services/cookie-monitor.ts` `poll` (`:134-180`), change the callback payload from the filtered `authCookies` to the full `cookies` array returned by `driver.cookieListFromState(session)`. Keep the gate (`authCookies.length < REQUIRED_COOKIES.size` → early return) and the `requireRotation` block (which still reads from the `authCookies` local) unchanged. Net edit: `onCookiesFound(authCookies)` → `onCookiesFound(cookies)` at `:179`.
- [x] 1.2 In `CookieMonitor.checkCookies` (`:114-132`), return the full `cookies` list when the gate passes, instead of `authCookies`. Net edit: `return authCookies` → `return cookies` at `:121`. The `[]` return for the gate-failed / throw paths is unchanged.
- [x] 1.3 Run `bun test tests/services/cookie-monitor.test.ts -t "full browser jar"` — the two RED tests from `7b2d55f` are green (`Expected length: 7` satisfied). Full file: 22 pass / 0 fail.

## 2. Update characterization tests that encoded the old 2-cookie payload

- [x] 2.1 No edit required. The existing characterization tests stub `cookieListFromState` with exactly the cookies they assert against (a 2-cookie "full jar"), so the full-jar contract holds trivially and all assertions pass unchanged. Verified green.
- [x] 2.2 No edit required. `calls onCookiesFound once interval ticks` and the three `requireRotation` "fires when…" tests assert `callback.mock.calls[0]![0]` equals the driver's return value — still exact-equal under the new payload (full = the stubbed list). Verified green.
- [x] 2.3 No non-payload assertion weakened — gate behavior, stop/idempotent, eval throws, requireRotation baseline-match suppression, and timeout `unref` all unchanged and green.

## 3. Verify

- [x] 3.1 `bun run typecheck` — clean.
- [x] 3.2 `bun test tests/services/cookie-monitor.test.ts` — 22 green (2 former-RED + 20 characterization).
- [x] 3.3 `bun test tests/services/cookie-jar-repro.test.ts` — 3 green (harness unaffected).
- [x] 3.4 `bun test` — full suite 928 pass / 0 fail / 2 skip / 1945 expects / 57 files. Baseline restored to 0-fail (was 2 red from `7b2d55f`).
- [x] 3.5 `phantom-auth` / `profile-auth-manager` / `auth-service` / `cookie-rotation` / `cookie-storage-service` test files untouched and green (they stub the monitor/silentRefresh at the seam).

## 4. CHANGELOG patch (folded into v2.6.2)

- [x] 4.1 In `CHANGELOG.md`, added the headline "cookie monitor trimmed the browser jar" bullet to `### Fixed`, and reframed the prior "list returned 0 chats" bullet as the complementary proactive-rotation + L2-escalation gap-closure. Noted already-degraded profiles require one `gemiterm login` / `auth -e` to repopulate. Updated Internal test count (928/1945) and added the repro-harness bullet.

## 5. Spec sync

- [ ] 5.1 Archive this change (`openspec archive`) so the `auth` delta (the two MODIFIED CookieMonitor requirements) syncs into the main `openspec/specs/auth/spec.md`. Run `/test-baseline eval` per `openspec/config.yaml` guidance afterwards.
