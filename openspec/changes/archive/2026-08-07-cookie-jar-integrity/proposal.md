## Why

The persistent `list returned 0 chats` symptom has a single upstream root cause: `CookieMonitor` trims the browser jar to only `__Secure-1PSID` / `__Secure-1PSIDTS` before handing it to the capture callback. Every persistence path — headed `authenticate`/`renew` via `waitForLogin`, and `silentRefresh` L2 via `waitForSilentLogin` — flows through that callback, so the full auth cookie set Google issues (`SID`/`HSID`/`SSID`/`APISID`/`SAPISID`/`SIDCC`/`NID`/`__Secure-3PSID`/…) is discarded at the source and only PSID/PSIDTS (×2 domains = 4 cookies) is ever written to disk. `models()` and `readChat(<id>)` are PSID-only RPCs and keep working, so `ProfileAuthManager`'s probe reports "valid" indefinitely; but `listChats` enumeration requires the companion cookies and returns empty from a 4-cookie jar. The L2 escalation fix (`0b91cde`) is necessary but cannot resolve this — `silentRefresh`'s correct `mergeCookies` upsert faithfully *preserves* the already-degraded jar; it cannot add cookies the monitor never captured.

This is the 4th phantom-auth sub-bug (the prior three are archived under `openspec/changes/archive/2026-08-05-*`). A deterministic repro harness is committed (`tests/services/cookie-jar-repro.test.ts`, `efab987`) and two RED tests pinning the desired monitor contract (`tests/services/cookie-monitor.test.ts`, `7b2d55f`).

## What Changes

- In `CookieMonitor.poll` (`src/services/cookie-monitor.ts:134-180`) and `CookieMonitor.checkCookies` (`:114-132`), pass the FULL cookie list returned by `driver.cookieListFromState(session)` to the `onCookiesFound` callback (and as `checkCookies`'s return), instead of the `REQUIRED_COOKIES`-filtered subset. The `REQUIRED_COOKIES` set remains the GATING predicate (the callback fires only once both required cookies are present); it no longer constrains the PAYLOAD.
- The `requireRotation` baseline-change check (`:164-176`) continues to derive PSID/PSIDTS from the (now full) cookie list for its comparison — behavior unchanged; it already searches by name within the list.
- No change to `auth-service.ts`, `cookie-rotation.ts`, `cookie-storage-service.ts`, or `profile-auth-manager.ts`: the downstream persistence is already structurally correct (`extractCookies`/`cookieStorage.save` will now persist the full jar; `silentRefresh`'s `mergeCookies` upsert at `auth-service.ts:300-302` will now merge a full polled set into the existing full jar). They were being starved of cookies by the monitor, not by their own logic.
- Update the spec-encoding tests that assert the buggy 2-cookie payload contract in `tests/services/cookie-monitor.test.ts`: the `checkCookies` characterization (`:94`), the `start/stop` callback test (`:129`), and the `requireRotation` "fires when…" tests (`:249`/`:272`/`:295`). The two RED tests from `7b2d55f` ("start passes the full browser jar…", "checkCookies returns the full browser jar…") go green.
- Amend the v2.6.2 CHANGELOG: the "list returned 0 chats" headline becomes accurate once this lands; the L2 escalation (`0b91cde`) is recharacterized as a complementary gap-closure, not the headline fix.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `auth`: The `CookieMonitor` capture contract changes from "filter to `REQUIRED_COOKIES` before invoking the callback / returning from `checkCookies`" to "gate on `REQUIRED_COOKIES` presence, but pass the FULL browser jar through". The `authenticate`/`renew`/`silentRefresh` capture paths consequently persist the complete auth cookie set, not just PSID/PSIDTS.

## Impact

- **Code**: `src/services/cookie-monitor.ts` (`poll` `:134-180`, `checkCookies` `:114-132`). Sensitive auth area — matching service test re-read before edit. `checkCookies` has no live caller in `src/` (verified); the behavioral blast radius is `poll` (the real capture path) plus the public-helper contract.
- **Specs**: `auth` — the `CookieMonitor polls every 2 seconds…` requirement (`:54-55`) and the `CookieMonitor exposes checkLoggedIn and checkCookies helpers` requirement (`:77-78`), plus their `fires callback` / `checkCookies` scenarios. The `authenticate` requirement is unchanged in the spec: `auth-service.test.ts` mocks the monitor at the seam (it supplies its own 2-cookie callback payload), so `authenticate`'s "save captured cookies" contract is agnostic to jar size.
- **Tests**: `tests/services/cookie-monitor.test.ts` (green the 2 RED tests; update the ~5 characterization tests asserting the 2-cookie payload). No change to `phantom-auth.test.ts` / `profile-auth-manager.test.ts` (they stub the monitor/silentRefresh at the seam and are unaffected).
- **Behavior**: `list`/`list -i` return the real chat count against a freshly-authenticated profile; the 4-cookie degraded jar no longer occurs on fresh capture. Already-degraded profiles require one `gemiterm login` / `auth -e` to repopulate — the fix does not retroactively backfill existing on-disk jars (out of scope; `status -v` surfaces cookie ages to help users decide).
- **Dependencies**: none. Reuses `driver.cookieListFromState` which already returns the full jar.
