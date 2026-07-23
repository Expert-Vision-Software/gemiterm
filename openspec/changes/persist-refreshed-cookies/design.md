# Design: Persist refreshed Gemini cookies back to profile storage

## Context

`gemini-reverse` merges `set-cookie` headers from every Gemini response into
the live client's in-memory jar — verified in 1.0.12 (`client.js:530,760`)
and 2.1.0 (`src/gemini.js` `_stream`, `_batchExecute`, plus init's
`validCookies` merge). The 2.1.0 rewrite removed the explicit rotate-cookies
flow, making this passive merge the **only** cookie-freshness path. We load
`__Secure-1PSID`/`__Secure-1PSIDTS` from `CookieStorage` at client
construction and never write back, so refreshed values die with the process
and the stored cookie goes stale on Google's schedule.

Today the only writer of cookie storage is `auth-service.ts` (full Playwright
capture with complete cookie metadata). `CookieStorageService`
(load/validate/freshness/expiry) has no save method. `GeminiClientService`
already carries optional `cookieStorageService` + `profileName` (set on the
default and `forProfile` instances; absent on the CLI's empty factory
client), and its `client.cookies` jar is a public mutable dict — all the
seams needed already exist.

Depends on `upgrade-gemini-reverse-2-1-0` (land that first; this change adds
call sites inside the same wrapper it rewrites).

## Goals / Non-Goals

**Goals:**

- Persist client-refreshed `__Secure-1PSID` / `__Secure-1PSIDTS` to the
  active profile's stored cookies after successful API operations.
- Preserve each stored cookie's existing metadata
  (domain/path/httpOnly/secure/sameSite); refresh its `expires`.
- Zero user-facing failure modes: persistence problems never break commands.

**Non-Goals:**

- No other Google cookies (NID, 1PSIDCC, …) — we only store/load/pass the
  two today, and the on-disk layout is unchanged.
- No change to the 7-day freshness rule itself, no guest-mode support, no
  close()/timer hooks (the CLI process exits without `close()`).

## Decisions

### D1 — Save seam lives on `CookieStorageService`

Add `saveCookiesForProfile(profileName: string, cookies: Cookie[]): void`
delegating to the composed `CookieStorage.save`. The wrapper stays at the
service layer and never touches `CookieStorage` directly — consistent with
existing DI composition (`auth-service` is the only current direct writer,
for the login capture path; this is not disturbed).

### D2 — Persist eagerly at the end of each successful public method

`init()` (its response performs the first merge) and each API method's
success path call a private `persistRefreshedCookies()`. Eager beats
close()-based flushing here because the CLI exits without calling `close()`.
Change detection keeps it cheap: remember the cookie values the instance was
constructed with; write only when the live jar differs. After a successful
write, update the remembered values so subsequent calls are no-ops.

### D3 — Merge into the stored list; preserve metadata; refresh `expires`

Load the profile's stored `Cookie[]`, replace the entries for the two cookie
names with the live jar values, keep each entry's existing
domain/path/httpOnly/secure/sameSite, and set
`expires = now + 7 days` (aligned with the freshness window). Alternative
considered: keep the original `expires` — rejected, it defeats the purpose;
a cookie Google just re-issued is fresh by definition, and the 7-day local
heuristic restarts from last refresh. This *is* the session-extension
behavior the change exists for.

### D4 — Failure isolation

The whole persist step is wrapped: any throw is caught and logged at
`debug`; the triggering operation's result is returned normally. A storage
hiccup must never turn into a user-visible command failure.

### D5 — No-op guards

Skip when: no `cookieStorageService`, no `profileName`, no constructed
client, the jar lacks a value for a tracked cookie, or values are unchanged.
This automatically excludes the CLI's empty factory client and keeps
`forProfile` instances scoped to their own profile's storage.

### D6 — Test strategy

Extend the existing `gemini-reverse` module mock so client instances expose a
mutable `cookies` dict the test can mutate post-construction, then drive the
four spec scenarios through the real wrapper. `CookieStorageService`'s new
method gets a delegation test in its own suite (sensitive area — re-read
`tests/services/cookie-storage-service.test.ts` before committing, per
AGENTS.md).

## Risks / Trade-offs

- **[Persisting a bad value corrupts a working stored session]** → Values
  are only taken from the jar *after successful* API calls (a 401/403 path
  throws before persist runs); write goes through the existing atomic
  `io.ts` JSON path; worst case matches today's re-login flow.
- **[Concurrent CLI invocations overwrite each other]** → Last-writer-wins
  on the same account is benign (both writers hold Google-issued values);
  identical to today's auth-write behavior.
- **[Refreshed `expires` masks a server-side-dead session]** → The next API
  call surfaces `AuthError` → existing "run 'gemiterm login' again" path.
  No worse than the status quo.
- **[Sensitive-area regression in cookie handling]** → Strictly additive
  (one new method + one private helper); no existing method signatures or
  call sites change; service-level tests re-read before commit.

## Migration Plan

Single commit after `upgrade-gemini-reverse-2-1-0` is merged. Deploy =
normal release. Rollback = revert the commit; stored cookies written by this
change remain valid (same layout), so no data migration either direction.

## Open Questions

None. (User-visible "session refreshed" notice: default is debug-level
logging only — the refresh is meant to be invisible.)
