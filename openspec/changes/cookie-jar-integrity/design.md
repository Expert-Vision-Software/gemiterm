## Context

`CookieMonitor` (`src/services/cookie-monitor.ts`) is the single chokepoint through which every cookie-capture path flows. Two methods trim the browser jar to the `REQUIRED_COOKIES` set (`{"__Secure-1PSID", "__Secure-1PSIDTS"}`):

- `poll` (`:134-180`): on each 2 s tick, after the sign-out-link probe fires, it does `const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name))`, gates on `authCookies.length >= REQUIRED_COOKIES.size`, optionally runs the `requireRotation` baseline check, then invokes `onCookiesFound(authCookies)` — passing only the filtered subset.
- `checkCookies` (`:114-132`): same filter, returns `authCookies` (or `[]`).

The callback consumers:

- `AuthService.waitForLogin` (`auth-service.ts:147-173`) resolves the headed-capture promise with whatever the callback passes; `extractCookies` (`:175-179`) then `cookieStorage.save`s it verbatim. So headed `authenticate`/`renew` persist only PSID/PSIDTS.
- `AuthService.waitForSilentLogin` (`:312-341`) resolves the L2 `silentRefresh` promise the same way; `silentRefresh` then `mergeCookies(existing, cookies)` (`:300-302`). `mergeCookies` (`:20-30`) is a correct upsert by `(name, domain, path)` — it preserves existing entries and adds new ones — but it can only ever see the trimmed set, so it faithfully preserves an already-degraded jar.

`driver.cookieListFromState(session)` already returns the full jar from the browser. The trim is purely a local filter. `models()` and `readChat(<id>)` are PSID-only RPCs and keep working with a 4-cookie jar, so `ProfileAuthManager`'s probe (`phantom-auth-detection`) reports "valid" indefinitely; `listChats` enumeration requires the companion cookies and returns empty — the production symptom.

Constraints:
- The `REQUIRED_COOKIES` presence check is the correct GATE (the monitor must not fire until login is real — both auth cookies present). It must be preserved.
- The `requireRotation` baseline check (`:164-176`) compares PSID/PSIDTS values; it must keep working.
- Sensitive auth area (AGENTS.md): re-read `tests/services/cookie-monitor.test.ts` before editing. Done.
- The downstream merge/save code is correct and must not change — the fix is upstream.

## Goals / Non-Goals

**Goals**
- The capture callback (`onCookiesFound`) and `checkCookies` return value carry the FULL browser jar, not just `REQUIRED_COOKIES`.
- Fresh `gemiterm login` / `auth -e` / successful L2 `silentRefresh` persist the complete auth cookie set, so `listChats` returns chats.
- Preserve the login gate (both required cookies present before firing) and the `requireRotation` semantics unchanged.

**Non-Goals**
- Retroactively backfilling already-degraded on-disk jars. A profile already at 4 cookies needs one re-auth to repopulate; the fix does not rewrite existing `storage_state.json` files. (`status -v` surfaces cookie ages to make this visible.)
- Changing `mergeCookies`, `resolveCookie`, `rotateCookies`, or `ProfileAuthManager`. They are correct.
- Changing the login-detection probe (`LOGIN_PROBE_JS`, the sign-out-link check). Unchanged.
- Adding a `listChats`-based validity probe (rejected previously — regressive).

## Decisions

### Decision 1: Separate the gating predicate from the payload

The fix is to stop conflating "which cookies gate the callback" with "which cookies the callback receives." Keep `authCookies` (the filtered local) as the gate and as the source for the `requireRotation` comparison; pass the full `cookies` array as the payload.

Concretely, two surgical edits:
- `poll` (`:179`): `onCookiesFound(authCookies)` → `onCookiesFound(cookies)`.
- `checkCookies` (`:121`): `return authCookies` → `return cookies`.

The gate (`authCookies.length < REQUIRED_COOKIES.size` → `return`/`return []`) and the `requireRotation` block (which reads `authCookies.find(...)`) are untouched and continue to behave identically.

**Rationale:** `REQUIRED_COOKIES` was correct as a *login* predicate and wrong as a *persistence* filter. Treating them independently is the smallest change that closes the bug without touching any downstream code. The gate still guarantees the callback fires only after a real login.

**Alternatives considered:**
- **Broaden `REQUIRED_COOKIES` to include companion names** — wrong direction: it would make the login gate stricter (refuse to fire until SID/HSID/SSID arrive, which races and may not all be set at the instant of login), and still would not carry arbitrary future cookies. The gate and the payload should not be the same set.
- **Add a second capture pass that re-reads the full jar after the gate fires** — extra driver round-trip, extra latency, and races with the browser still settling. The full jar is already in hand at poll time (`cookies`).
- **Change `mergeCookies` to synthesize missing cookies** — impossible; it has no source for them. The cookies only exist in the browser, captured once.

### Decision 2: Fix `checkCookies` for contract consistency even though it has no live caller

`checkCookies` has no caller in `src/` (verified by search — `poll` inlines its own filter). It is a public, spec'd helper, and it carries the same latent trim bug. Fixing it keeps the public contract honest and is covered by the existing RED test and the `auth` spec scenario. Risk is contained to tests (no live behavior change).

### Decision 3: Leave downstream persistence code unchanged

`AuthService.extractCookies` (`cookieStorage.save`) and `silentRefresh`'s `mergeCookies(...)`+`saveCookiesForProfile` are already correct for a full payload: `save` writes whatever it receives; `mergeCookies` upserts by `(name, domain, path)`, preserving existing entries and appending new ones. Once the monitor hands them the full jar, they persist it. No edit needed — confirmed by reading `auth-service.ts:20-30,175-179,300-302` and `cookie-storage-service.ts`.

## Risks / Trade-offs

- **[Existing degraded jars are not auto-healed]** → Documented in CHANGELOG and surfaced via `status -v`; one `gemiterm login`/`auth -e` repopulates. Acceptable: the fix prevents recurrence; backfill would require a risky one-shot migration with no way to test against real Google state.
- **[Persisted jar grows from ~4 to ~12 cookies]** → Negligible storage; `storage_state.json` stays a few KB. No perf impact.
- **[Test churn: ~5 characterization tests assert the old 2-cookie payload]** → Expected and correct; these tests encoded the bug. Updated as part of the fix commit. The 2 RED tests (`7b2d55f`) go green.
- **[A partially-set jar at login instant]** → The gate already requires both PSID+PSIDTS, which is Google's login signal; companion cookies are set in the same response envelope. If a companion were transiently absent at the poll tick, the full jar captured is simply the jar at that instant — on the next capture (any future login/refresh) it normalizes. This matches real browser behavior and is strictly better than today's guaranteed-trim.
- **[`requireRotation` reads values from the filtered local, not the full list]**** → Intentional and unchanged; PSID/PSIDTS resolution by name is unaffected by payload size.

## Migration Plan

Single-PR, backwards-compatible at the CLI surface. No config/data migration. Ship under v2.6.2 alongside the L2 escalation (`0b91cde`); the CHANGELOG "list returned 0 chats" headline attaches to THIS change (the L2 fix becomes a complementary gap-closure). Users with degraded profiles run `gemiterm login` (or `gemiterm auth -e <name>`) once after upgrading.

## Open Questions

None. Root cause is confirmed (the trim is a local filter on data already in hand), the fix is a 2-line payload change, the harness (`efab987`) reproduces the symptom deterministically, and the RED tests (`7b2d55f`) pin the target contract.
