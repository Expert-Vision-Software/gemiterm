# Tasks: cookie-jar-integrity

> Prior art already landed on this branch: the deterministic repro harness (`tests/services/cookie-jar-repro.test.ts`, commit `efab987`) and the two RED tests pinning the desired monitor contract (`tests/services/cookie-monitor.test.ts`, commit `7b2d55f`). These tasks green the RED tests and align the surrounding characterization.

## 1. Green the RED tests (the fix)

- [ ] 1.1 In `src/services/cookie-monitor.ts` `poll` (`:134-180`), change the callback payload from the filtered `authCookies` to the full `cookies` array returned by `driver.cookieListFromState(session)`. Keep the gate (`authCookies.length < REQUIRED_COOKIES.size` → early return) and the `requireRotation` block (which still reads from the `authCookies` local) unchanged. Net edit: `onCookiesFound(authCookies)` → `onCookiesFound(cookies)` at `:179`.
- [ ] 1.2 In `CookieMonitor.checkCookies` (`:114-132`), return the full `cookies` list when the gate passes, instead of `authCookies`. Net edit: `return authCookies` → `return cookies` at `:121`. The `[]` return for the gate-failed / throw paths is unchanged.
- [ ] 1.3 Run `bun test tests/services/cookie-monitor.test.ts -t "full browser jar"` — confirm the two RED tests from `7b2d55f` are now green (`Expected length: 7` satisfied).

## 2. Update characterization tests that encoded the old 2-cookie payload

- [ ] 2.1 In `tests/services/cookie-monitor.test.ts`, update "returns auth cookies when both required cookies present" (`:149`) — the existing `authCookies` (length-2) fixture now flows through unchanged, but assert the result equals the FULL input list the driver returned. Where a test supplies only the 2 required cookies via `cookieListFromState`, the full-jar contract still holds (full = those 2); update the assertion wording/intent, not the fixture, where the fixture is the entire browser state.
- [ ] 2.2 Update "calls onCookiesFound once interval ticks" (`:184`) and the three `requireRotation` "fires when…" tests (`:312`/`:335`/`:358`) — `callback.mock.calls[0]![0]` now equals the full list the driver returned. Where those tests mock `cookieListFromState` with only the 2 auth cookies, the assertion still holds (full = those 2); confirm each still passes, and where a `fullJar`-style input is available, prefer asserting the full payload.
- [ ] 2.3 Do NOT weaken any non-payload assertion (gate behavior, stop/idempotent, eval throws, requireRotation baseline-match suppression, timeout `unref`). The login gate and rotation semantics are unchanged.

## 3. Verify

- [ ] 3.1 `bun run typecheck` — clean.
- [ ] 3.2 `bun test tests/services/cookie-monitor.test.ts` — all green (the 2 former-RED + the updated characterizations).
- [ ] 3.3 `bun test tests/services/cookie-jar-repro.test.ts` — still green (the harness characterizes the symptom at the SDK seam; unaffected by the monitor fix, but must not regress).
- [ ] 3.4 `bun test` — full suite green, 0 fail. Baseline returns to 0-fail (was 2 red from `7b2d55f`). Expect 928 pass / 0 fail / 57 files (the 3 harness tests + the 2 now-green former-RED tests).
- [ ] 3.5 Confirm `tests/services/{phantom-auth,profile-auth-manager,auth-service,cookie-rotation,cookie-storage-service}.test.ts` are untouched and still green (they stub the monitor/silentRefresh at the seam).

## 4. CHANGELOG patch (folded into v2.6.2)

- [ ] 4.1 In `CHANGELOG.md`, recharacterize the v2.6.2 "list returned 0 chats" entry: the headline fix is the cookie-monitor full-jar capture (this change); the L2 escalation (`0b91cde`) is a complementary gap-closure, not the headline. Note that already-degraded profiles require one `gemiterm login` / `auth -e` to repopulate.

## 5. Spec sync

- [ ] 5.1 After implementation is green, archive this change (`openspec archive`) so the `auth` delta (the two MODIFIED CookieMonitor requirements) syncs into the main `openspec/specs/auth/spec.md`.
