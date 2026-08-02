# Phantom Authentication — Investigation Findings

> Investigation feed for the `phantom-auth-ultimate-fix` grilling session.
> This document captures the raw subagent output (file:line citations, the
> bug-report narrative, the 5-hypothesis ranking, the 2 open questions) so
> the grilling session can start from a known-good state without re-deriving
> the evidence. The canonical plan deliverable lives outside the repo at
> `C:\Users\diego\.plannotator\plans\plan-phantom-authentication-lo-2026-08-02-approved.md`
> — read both for full context.

**Authoring session:** 2026-08-02 (the v2.5.0 cycle)
**Affected change:** `phantom-auth-ultimate-fix` (this folder)
**Companion change:** `phatom-auth-repro-with-tests/`
**Baseline:** `BL-004` — 868 pass / 2 skip / 0 fail
(`docs/testing-baseline.xml:1-19`)

---

## TL;DR

After approximately two hours from `gemiterm auth`, every user-facing
operation (`list`, `fetch`, `send`, `new`, `export`, `delete`) silently
stops returning data, despite the profile table showing **ACTIVE: ✓ Yes**
and the cookie file showing expires dates a year in the future. The CLI
prints `[INFO] [mediator] Profile '<name>' is authenticated` and then
returns `No conversations found.`

**Root cause (5-subagent investigation, ranked):**

1. **H1 STRONGLY SUPPORTED** — the auth gate has no server-side validity
   check anywhere. `checkCookieFreshness` is purely local, `ensureAuthenticated`
   trusts it, and the only server probe (`silentRefresh`) is gated behind
   the local check. Google's server-side session can be invalidated before
   the cookie's declared `expires` — the local freshness check never
   notices.

2. **H4 BUG CONFIRMED** — `silentRefresh` is doubly broken: (a)
   `autoExtendSession` short-circuits to `true` when local cookies are
   fresh, so `silentRefresh` is rarely called; (b) when `silentRefresh`
   *is* called, it is a no-op — the poll loop returns the just-loaded
   cookies on first tick without waiting for Google's actual rotation.

3. **H3 BUG CONFIRMED** (latent) — `persistRefreshedCookies` merges
   cookies by `name` only, not `(name, domain)`. On profiles whose
   storage file contains both `.youtube.com` and `.google.com` pairs
   for the same cookie name (the user's case has both), the merge
   silently overwrites the YouTube entry's value with the Google one
   whenever Google rotates. **H5 confirms this hasn't fired recently on
   the user's files** (per-domain values are still distinct), so it is a
   latent bug, not the cause of the current symptom.

4. **H2 REFUTED** — the SDK's `client.cookies` jar divergence from disk
   does not happen. The SDK sends `this.cookies` directly; baselines
   only control when to write. The `.google.com` value wins via Map
   iteration order, and that value is what the SDK uses.

5. **H5 INCONCLUSIVE / mis-framed** — the user described the expires
   ordering as "PSIDTS expires AFTER PSID". The on-disk data shows the
   opposite (PSID > PSIDTS by ~35 days), which is what Google actually
   does. The magnitudes are anomalous (PSIDTS at 365 days instead of
   hours/days), and the (PSIDTS − PSID) delta is exactly −35 days across
   all three profiles — likely a fingerprint of the SDK's renewal window,
   not a client-side bug.

**The fix needs three coordinated changes:**

1. Add a server-side probe to `ProfileAuthManager.ensureAuthenticated`,
   gated behind a process-level cache, that detects the
   empty-after-fresh-init case.
2. Tighten `AuthService.silentRefresh` to fail (not succeed) when the
   loaded cookies are unchanged.
3. Fix `persistRefreshedCookies` to merge by `(name, domain)`.

---

## The 5 hypotheses, ranked

### H1 — Phantom auth: server-side session invalidated; `expires` is a cap, not a contract

**Verdict: STRONGLY SUPPORTED.**

**Subagent evidence (file:line citations):**

Every freshness/validity predicate in `src/` consults ONLY local cookie
data — the `expires` field is treated as the source of truth for session
liveness:

| Predicate | File:Line | Local? |
|---|---|---|
| `checkCookieFreshness(cookies)` | `src/infrastructure/storage.ts:41` | YES |
| `checkCookieFreshness(cookies)` | `src/services/cookie-storage-service.ts:58` | YES |
| `validateCookies(cookies)` | `src/infrastructure/storage.ts:20` | YES |
| `getCookieExpiryTimestamp(cookies)` / `getCookieExpiryMs(cookies)` | `src/infrastructure/storage.ts:25`, `src/services/cookie-storage-service.ts:74` | YES |
| `hasValidStoredCookies` (private) | `src/infrastructure/storage.ts:203` | YES |
| `hasFreshCookies` (private) | `src/infrastructure/storage.ts:212` | YES |
| `hasValidCookies(profileName)` | `src/infrastructure/storage.ts:195` | YES |
| `hasStoredCookies(profileName)` | `src/infrastructure/storage.ts:199` | YES |
| `ProfileManager.getStatus(name).isActive` | `src/infrastructure/storage.ts:161` | YES |
| `ProfileManager.loadCookiesForApi(profileName)` | `src/infrastructure/storage.ts:221` | YES |
| `ProfileAuthManager.autoExtendSession` | `src/services/profile-auth-manager.ts:36` | PARTIALLY (silentRefresh is a server probe but gated) |

**`ensureAuthenticated` does NOT probe the server on the hot path** —
`src/services/profile-auth-manager.ts:54-71`:

```ts
async ensureAuthenticated(profileName?: string): Promise<LoadedCookies> {
  const name = profileName ?? getDefaultProfileName();
  validateProfileName(name);

  if (!this.profileManager.hasValidCookies(name)) {        // ← LOCAL check
    const extended = await this.autoExtendSession(name);
    if (extended) { ... return ...; }
    throw new AuthenticationError(...);
  }

  this.logger.info(`Profile '${name}' is authenticated`);  // ← LOGGED when local check passes
  return this.cookieStorageService.loadCookiesForProfile(name);  // ← LOCAL file read
}
```

When cookies are fresh (the user's case — expires 2027), `ensureAuthenticated`
returns without contacting Google at all. It never calls
`geminiClient.listChats` (or any other SDK call) as a probe.

**The only server-side probe is `silentRefresh`, and it is gated on local
cookie state** — `src/services/profile-auth-manager.ts:36-52`:

```ts
async autoExtendSession(profileName: string): Promise<boolean> {
  ...
  cookies = this.cookieStorageService.loadAllCookiesForProfile(name);
  if (checkCookieFreshness(cookies)) {                     // ← LOCAL
    return true;                                            // ← NO BROWSER LAUNCHED
  }
  return this.silentRefresh(name);                          // ← server probe only if local check FAILS
}
```

**`GeminiClientService.init()` does contact Google, but not to validate the
session.** The SDK throws `AuthError('Cookies invalid.')` only when **all
three** of `cfb2h`, `fdrfje`, `language` are absent from the response
(`node_modules/gemini-web-sdk/src/utils/auth.js:30-44`). Partial
invalidation (soft-logout, account-restricted state, quota exhausted)
does NOT necessarily trigger this — Google may return 200 with at least
one of those tokens present, and the chat list simply comes back empty.

**Hop-by-hop call chain from `gemiterm list -i` to "No conversations found.":**

| Hop | File:Line | Server-side validity check? |
|---|---|---|
| 1 | `src/cli/index.ts:172-228` (`main()`) | none |
| 2 | `src/cli/commands/list-command.ts:50` (`ListCommand.execute`) | none |
| 3 | `src/cli/commands/list-command.ts:61-73` (mediator.send) | none |
| 4 | `src/core/query-handlers.ts:91-133` (`ListChatsQueryHandler.handle`) | none |
| 5 | `src/core/query-handlers.ts:94` (`getGeminiClient()` factory) | none |
| 6 | `src/cli/index.ts:89` (`profileAuthManager.ensureAuthenticated`) | **LOCAL ONLY** |
| 7 | `src/services/profile-auth-manager.ts:54-71` | **NO server probe when local check passes** |
| 8 | `src/cli/index.ts:99-108` (`buildClient`) | none |
| 9 | `src/core/query-handlers.ts:113-115` (forProfile / listChats) | none |
| 10 | `src/services/gemini-client-wrapper.ts:206-219` (forProfile) | none |
| 11 | `src/services/gemini-client-wrapper.ts:227-261` (listChats → SDK chats()) | **implicit server round-trip, NOT a liveness probe** |
| 12 | `node_modules/gemini-web-sdk/src/gemini.js:892-926` (SDK _fetchRecentChats) | returns `[]` on empty chat list |
| 13 | `src/services/gemini-client-wrapper.ts:234-238` | throws GemitermError on null/undefined; `[]` is silent success |
| 14 | `src/core/query-handlers.ts:117-128` | accumulates; Promise.allSettled catches errors as warnings |
| 15 | `src/cli/commands/list-command.ts:75-80` | `chats = result.chats;` → `runInteractiveBrowser` |
| 16 | `src/cli/utils/prompts.ts:461-463` | renders "No conversations found." |

**`[]` is treated as silent success at every layer.** `null`/`undefined`
throws `GemitermError("Gemini returned no data — session may be expired")`
(`gemini-client-wrapper.ts:236`), but even that does NOT route through
`promptAndReauth` because it is a `GemitermError`, not an
`AuthenticationError` (only `AuthenticationError` triggers
`promptAndReauth` at `src/cli/index.ts:91-96`).

**Git history confirms this is by design, not an oversight.** Every
commit touching freshness/session validity is about (a) tuning the local
threshold, (b) auto-extending with a headless browser when local check
fails, or (c) propagating errors out of the SDK layer:

- `7e2c486` *fix(auth): stop overwriting cookie expires, reduce freshness threshold to 1h, add freshness check to getStatus*
- `f787ffd` *spec: enhance ProfileManager.getStatus() to enforce cookie freshness check*
- `da215dc` *feat(auth): auto-extend session silently + prompt-to-reauth*
- `bc09857` *feat(auth): implement auto-lifecycle for session management*
- `271335a` *fix: listChats throws on null SDK return; profileHasConversation propagates errors*
- `99d0b17` *feat(auth): persist refreshed Gemini cookies to profile storage*
- `2392a8d` *feat(profile): introduce hasStoredCookies method and refactor cookie validation logic*

**OpenSpec codifies the contract** — `openspec/specs/storage/spec.md:186-203`
defines "valid and fresh" purely in terms of the on-disk cookie
`expires` field. `openspec/specs/auth/spec.md:204-206` ("Returns
cookies for a profile with valid session") requires no server
round-trip in the fresh-cookies path. The `silentRefresh` server probe
is explicitly scoped to "the 1-hour grace window" — see
`openspec/specs/auth/spec.md:208-211` ("Auto-extends session before
throwing AuthenticationError").

**Local repro matches the bug exactly.** All four cookies in
`C:\dev\projects\github\gemiterm\.gemiterm\profiles\evs-diegohb\storage_state.json`
expire in 2027. `gemiterm list -i` returns "No conversations found."
because Google's response carries no chat data — exactly the observable
symptom of server-side invalidation that the client cannot detect.

---

### H4 — `silentRefresh` is a no-op when the loaded cookies are locally valid

**Verdict: BUG CONFIRMED (no-op when local valid) AND often unreachable.**

**`silentRefresh` flow** — `src/services/auth-service.ts:193-230`:

```ts
async silentRefresh(profileName: string, timeoutMs = SILENT_REFRESH_TIMEOUT_MS): Promise<boolean> {
  // ...
  await this.driver.openHeadless(GEMINI_AUTH_URL, name, name);    // (a)
  // ...
  await this.driver.stateLoad(name, statePath);                   // (b) load existing cookies
  const cookies = await this.waitForSilentLogin(name, timeoutMs); // (c) start monitor
  if (cookies) {
    await this.extractCookies(name, cookies);                     // (g) save back
  }
  return cookies !== null;                                        // (h)
}
```

**CookieMonitor poll loop** — `src/services/cookie-monitor.ts:127-158`:

```ts
private async poll(session: string, onCookiesFound: CookiesFoundCallback): Promise<void> {
  if (this._stopped) return;
  let signal: string;
  try { signal = await this.driver.evalJs(session, LOGIN_PROBE_JS); } catch { return; }
  if (signal.trim() !== "true") return;                          // (d) sign-out link visible?

  let cookies: Cookie[];
  try { cookies = await this.driver.cookieListFromState(session); } catch { return; }
  const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name));
  if (authCookies.length < REQUIRED_COOKIES.size) return;

  this.stop();
  onCookiesFound(authCookies);                                     // (f) → resolve
}
```

The monitor's exit condition is **"sign-out link present AND both required
cookies in state"**. When `stateLoad` has just put freshly-loaded cookies
into the browser session, both conditions are satisfied on the first poll
(~2 s after `start`). Google does not rotate `__Secure-1PSIDTS` during a
passive page load, so the cookies returned by `cookieListFromState` are
byte-identical to what was loaded. `extractCookies` writes them back to
disk unchanged — a true write no-op.

**`autoExtendSession` short-circuits in the typical post-auth path** —
`src/services/profile-auth-manager.ts:36-52`:

```ts
async autoExtendSession(profileName: string): Promise<boolean> {
  let cookies: Cookie[];
  try { cookies = this.cookieStorageService.loadAllCookiesForProfile(name); } catch { return false; }
  if (checkCookieFreshness(cookies)) {        // ← 1-hour threshold; just-authed cookies are ~1 year out
    return true;                              // ← short-circuit; silentRefresh NEVER called
  }
  return this.silentRefresh(name);
}
```

For a freshly-authenticated session, PSIDTS `expires` is ~1 year out,
so freshness passes and `silentRefresh` is never invoked. The existing
test `tests/services/profile-auth-manager.test.ts:229-242` explicitly
asserts this short-circuit behavior.

**`waitForSilentLogin` timeout failure mode.** If the page load takes
longer than 30 s, the monitor times out → `silentRefresh` returns
`false` → `autoExtendSession` returns `false` → `ensureAuthenticated`
throws `AuthenticationError`. This is irrelevant to the reported
symptom because in the user's case, `silentRefresh` is never even
attempted.

**`SILENT_REFRESH_TIMEOUT_MS = 30_000` (`src/services/auth-service.ts:16`).**

**Test gap** — `tests/services/auth-service.test.ts:475-591` covers the
"success" case via a mock that returns cookies on first tick, but never
exercises the real poll loop against a state where the loaded cookies
are already valid. The cookie-monitor tests at
`tests/services/cookie-monitor.test.ts:128-201` verify polling mechanics
with a mocked `driver.cookieListFromState` but never prove that the
monitor would distinguish a fresh cookie from a rotated one.

---

### H3 — `persistRefreshedCookies` merge by `name` only

**Verdict: BUG CONFIRMED at the code level, not currently triggered on
the user's files.**

**The merge code** — `src/services/gemini-client-wrapper.ts:119-151`:

```ts
private persistRefreshedCookies(): void {
  try {
    if (!this.cookieStorageService || !this.profileName || !this.client) return;
    const jar = this.client.cookies as Record<string, string>;
    const live1psid = jar["__Secure-1PSID"];
    const live1psidts = jar["__Secure-1PSIDTS"];
    const changed1psid = typeof live1psid === "string" && live1psid !== "" && live1psid !== this.baselineSecure1psid;
    const changed1psidts = typeof live1psidts === "string" && live1psidts !== "" && live1psidts !== this.baselineSecure1psidts;
    if (!changed1psid && !changed1psidts) return;

    const stored = this.cookieStorageService.loadAllCookiesForProfile(this.profileName);
    let changed = false;
    const merged = stored.map((c) => {
      if (c.name === "__Secure-1PSID" && changed1psid) {
        changed = true;
        return { ...c, value: live1psid };                  // ← merge key is NAME only
      }
      if (c.name === "__Secure-1PSIDTS" && changed1psidts) {
        changed = true;
        return { ...c, value: live1psidts };
      }
      return c;
    });
    if (!changed) return;
    this.cookieStorageService.saveCookiesForProfile(this.profileName, merged);
    // ... baseline update
  } catch (e) {
    this.logger.debug(`persistRefreshedCookies failed: ${e}`);
  }
}
```

**Concrete before/after diff of the user's `storage_state.json` after
one `persistRefreshedCookies` call with SDK jar value `"NEW_VALUE_google"`:**

```diff
 {
   "cookies": [
     {
       "name": "__Secure-1PSIDTS",
       "value": "sidts-CjQBPWEu2Yex7nH0mUgehYkfYi244ApdtyoF_I_R87V6fXf-30FkZzhDxhNcrV9qLwDfu3-9EAA",
       "domain": ".youtube.com",                           ← unchanged
       ...
     },
     {
       "name": "__Secure-1PSID",
-      "value": "g.a000BAlfW9nYTVqPW-fYGh7uaMjyoa4f8UPM5LuKWir8Iy9JNalsqk5rTVMSVSvMK_IIUlRNDgACgYKAf8SARESFQHGX2MifELB9PPBfanIKKK9HSXQrRoVAUF8yKp2xA2w1_zL6UCuoh8tgXmu0076",
+      "value": "NEW_VALUE_google",                         ← .youtube.com value overwritten!
       "domain": ".youtube.com",
       ...
     },
     {
       "name": "__Secure-1PSID",
-      "value": "g.a000BAlfW4xGqBAkFSsAlcHrRTAzxKUEnpEx1cdnvHAnioI_od2Ox1OXk-lEHj-TeBLgrv2XKQACgYKAbkSARESFQHGX2Mi77nXpfvMcwIzGJNJiPar2BoVAUF8yKpsQp6jbFb450eGZa2yk_OY0076",
+      "value": "NEW_VALUE_google",                         ← .google.com value also overwritten (correct)
       "domain": ".google.com",
       ...
     },
     {
       "name": "__Secure-1PSIDTS",
       "value": "sidts-CjYBPWEu2R7IgxFzd31hPEGESvTMJVn4Ho1OXQCaGucQGc67suIEqZTC4zLrlpEWgwtA9BPHtHAQAA",
       "domain": ".google.com",                            ← unchanged
       ...
     }
   ]
 }
```

The merge code iterates ALL stored cookies matching the name and
overwrites each with the same `live1psid` value. The `.youtube.com`
PSID's value is silently replaced with the Google-domain value.

**SDK jar scope.** The SDK exposes only one value per cookie name:

```ts
this.client = new this.deps.Gemini({ secure_1psid: config.secure1psid, ... });
if (config.secure1psidts) {
  this.client.cookies["__Secure-1PSIDTS"] = config.secure1psidts;
}
```

The cookie parser strips everything after the first semicolon:

```js
// node_modules/gemini-web-sdk/src/utils/auth.js:11-20
function parseCookies(headers, base = {}) {
  const out = { ...base };
  const raw = headers['set-cookie'] || headers['Set-Cookie'];
  // ... strips domain, path, expires, secure, httpOnly, sameSite
  for (const s of arr) {
    const p = s.split(';')[0].trim();
    const eq = p.indexOf('=');
    if (eq !== -1) out[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
  }
  return out;
}
```

The SDK jar represents ONE value per cookie name, not all domain-scoped
cookies. It is effectively a single-domain/value-only jar with no way
to distinguish `.google.com` from `.youtube.com`.

**For the user's profile, the jar initially contains only the two
`.google.com` values selected by gemiterm** (the last duplicate wins
via Map iteration order in `CookieStorageService.loadCookiesForProfile`,
`src/services/cookie-storage-service.ts:27-40`):

```ts
const map = new Map(cookies.map((c) => [c.name, c.value]));
```

The `.youtube.com` values are neither loaded into the jar nor sent to
Gemini.

**However, the bug does NOT fire on the user's current files** (per H5
analysis). The on-disk `.youtube.com` and `.google.com` values are
distinct for both PSID and PSIDTS in all three profiles. If
`persistRefreshedCookies` had recently fired, both domain entries for
that name would now be identical. So this is a latent bug — real, but
not the cause of the *current* symptom.

**Test gap** — `tests/services/gemini-client-wrapper.test.ts:1342-1466`
covers `persistRefreshedCookies` but the storage fixture has only one
cookie per name (`tests/services/gemini-client-wrapper.test.ts:152-165`),
both under `.google.com`. No test detects that both `.youtube.com` and
`.google.com` entries are overwritten by the name-only merge.

**Archived design** (`openspec/changes/archive/2026-07-26-persist-refreshed-cookies/design.md:61-66`)
explicitly says "replace the entries for the two cookie names" — which
is consistent with the implemented name-only behavior. The design does
not specify `(name, domain)` identity. The fix should update this
design too.

---

### H2 — `client.cookies` jar divergence from disk

**Verdict: REFUTED.**

**`forProfile` selects the `.google.com` value (last duplicate wins)** —
`src/services/gemini-client-wrapper.ts:206-218`:

```ts
forProfile(profileName: string): GeminiClientService {
  if (!this.cookieStorageService) throw new Error("CookieStorageService is required for forProfile");
  const cookies = this.cookieStorageService.loadCookiesForProfile(profileName);
  return new GeminiClientService(
    { secure1psid: cookies.secure_1psid, secure1psidts: cookies.secure_1psidts },
    this.logger,
    this.cookieStorageService,
    profileName,
    this.deps,
    this.chatMetadata,
  );
}
```

The on-disk order in `evs-diegohb`:

1. YouTube `__Secure-1PSIDTS` (`yt-psidts` value)
2. YouTube `__Secure-1PSID` (`yt-psid` value)
3. Google `__Secure-1PSID` (`g-psid` value)
4. Google `__Secure-1PSIDTS` (`g-psidts` value)

So `loadCookiesForProfile` returns `g-psid` and `g-psidts` (the
`.google.com` values). The fresh SDK client's jar and baseline are
initialized from those.

**The SDK sends `this.cookies` directly; baselines only control when to
write.** The divergence mechanism — where the jar would somehow differ
from disk at request time, but gemiterm's baseline-comparison logic
would still write it back — does not exist:

- If the SDK changes the jar to a new non-empty value, it necessarily
  differs from the old baseline and persistence runs.
- If the SDK never changes the jar, it continues sending the same
  Google value selected from disk; the persistence no-op does not
  itself create divergence.

---

### H5 — Expires ordering forensic signal

**Verdict: INCONCLUSIVE — and the user mis-framed the direction.**

**On-disk expires tabulation** (today = 2026-08-02 UTC):

| Profile | Cookie | Domain | expires (epoch) | expires (ISO) | days_until_expiry |
|---|---|---|---|---|---|
| evs-diegohb | `__Secure-1PSIDTS` | `.youtube.com` | 1817171383.792770 | 2027-08-02 01:49:43.792 UTC | 365.08 |
| evs-diegohb | `__Secure-1PSID`   | `.youtube.com` | 1820195383.793217 | 2027-09-06 01:49:43.793 UTC | 400.08 |
| evs-diegohb | `__Secure-1PSID`   | `.google.com`  | 1820195383.825748 | 2027-09-06 01:49:43.825 UTC | 400.08 |
| evs-diegohb | `__Secure-1PSIDTS` | `.google.com`  | 1817171383.961242 | 2027-08-02 01:49:43.961 UTC | 365.08 |
| dhb-diegohb | `__Secure-1PSIDTS` | `.youtube.com` | 1817171141.276246 | 2027-08-02 01:45:41.276 UTC | 365.07 |
| dhb-diegohb | `__Secure-1PSID`   | `.youtube.com` | 1820195141.276542 | 2027-09-06 01:45:41.276 UTC | 400.07 |
| dhb-diegohb | `__Secure-1PSID`   | `.google.com`  | 1820195141.325677 | 2027-09-06 01:45:41.325 UTC | 400.07 |
| dhb-diegohb | `__Secure-1PSIDTS` | `.google.com`  | 1817171141.459771 | 2027-08-02 01:45:41.459 UTC | 365.07 |
| dhb-work    | `__Secure-1PSIDTS` | `.youtube.com` | 1816904873.413417 | 2027-07-29 23:47:53.413 UTC | 361.99 |
| dhb-work    | `__Secure-1PSID`   | `.youtube.com` | 1819928873.413738 | 2027-09-02 23:47:53.413 UTC | 396.99 |
| dhb-work    | `__Secure-1PSID`   | `.google.com`  | 1819928873.438927 | 2027-09-02 23:47:53.438 UTC | 396.99 |
| dhb-work    | `__Secure-1PSIDTS` | `.google.com`  | 1816904873.553097 | 2027-07-29 23:47:53.553 UTC | 361.99 |

**(PSIDTS − PSID) delta per profile: −35.000000 days**, identical across
all three profiles. This is the smoking gun: the fingerprint of a
single source, not Google's independent issuance.

**The user's framing was wrong:** PSID expires LATER than PSIDTS, which
is what Google actually does (PSID is the long-lived identity token,
PSIDTS is the short-lived session token). The direction is correct.

**The magnitudes are anomalous.** Real Google PSIDTS cookies are issued
with sub-day to sub-week expiries. A 365-day PSIDTS is **not consistent
with normal Google issuance** — it would only happen if the cookie was
forced to an arbitrary future expiry by something other than Google's
auth server.

**The H3 (merge-by-name) bug is REFUTED for these writes.** If H3 had
fired, the cookie values for `__Secure-1PSID` on `.youtube.com` and
`.google.com` would be identical, and the same for `__Secure-1PSIDTS`.
They are not. So `persistRefreshedCookies()` did not run on these files.

**The −35-day delta is consistent with the SDK's renewal behavior** —
the SDK may issue a `__Secure-1PSIDTS` with a fixed rolling window
during `init()` (`CHANGELOG.md:66` references this). The fingerprint
points at the upstream SDK's response-cookie behavior, not a
client-side expires bug.

---

## Repro on this machine (2026-08-02T22:28Z)

```
$ bunx gemiterm@latest list -i
[INFO] [mediator] Profile 'evs-diegohb' is authenticated
Browse conversations (0 chats | Sort: recent | Profile: all | Favorites: off)
No conversations found.

$ gemiterm auth
…
│ evs-diegohb *    │ ✓ Yes    │ Sep 5, 2027, 09:49 … │ Aug 1, 2026, 09:49 … │ Yes      │
…
```

**Dev-env setup (for follow-up sessions):**

- Profiles copied from `$APPDATA/gemiterm/profiles/` to
  `C:\dev\projects\github\gemiterm/.gemiterm/profiles/` (bunx-installed
  `default` and `zeek` also copied — these are the npx-resolved v2.5.0
  CLI's own defaults; only relevant for parity testing).
- Default-profile marker written to
  `C:\dev\projects\github\gemiterm/.gemiterm/profiles/.default`
  containing `evs-diegohb`.
- Reproduce: `bun run dev list --format json` →
  `Profile 'evs-diegohb' is authenticated` then `{ "chats": [] }`.

---

## The 2 open questions for the grilling session

These are the decisions the next session should drive.

### A. Probe cadence

Where does the server-side validity probe live, and how often does it fire?

- Every command invocation (`ensureAuthenticated` is called from
  `getGeminiClient()` factory in `src/cli/index.ts:79-97`, which is
  called by every command). Adds 1 round-trip per command.
- Every 5 minutes per process per profile (process-level TTL cache).
  Compromise: extra round-trip at most every 5 min.
- Every 24 hours per process per profile. Cheaper but slower to detect
  server-side invalidation.
- Only on `list` / `fetch` / `export` (read paths), not on `send` / `new`
  / `delete` (write paths). The latter are cheaper to retry.
- Only when the local freshness check fails (replacing the current
  `autoExtendSession` short-circuit). This is closer to today's behavior
  but loses the early-detection benefit.

The regression test `phantom-auth-repro-with-tests` includes a "Probe
budget" scenario that asserts "at most once per process per profile per
TTL window" — the test should be tightened or relaxed to match the
chosen answer.

### B. Empty-list detection

What probe do we use to distinguish "this profile has zero chats" from
"this session is rejected"?

- `geminiClient.listChats({ limit: 1 })` and treat `chats.length === 0`
  as rejection. Cheap but confuses "empty profile" with "stale session".
- A separate lightweight probe — e.g., `getProfileStatuses`, an OPTIONS
  pre-flight to `gemini.google.com`, or `readChat` of a known sentinel
  conversation. More accurate but more round-trips.
- Compare against a cached baseline — if the cached `listChats` length
  from the last successful operation is ≥ 1, an empty result on the
  next call is a strong stale-signal. Cheap and accurate, but requires
  maintaining a baseline counter.

The phantom-auth-detection spec scenario "listChats(non-empty) means
session is valid; no silent refresh spent" assumes option 1
(`listChats({ limit: 1 })` with `chats.length > 0`). If a different
probe is chosen, the mock seam in `tests/services/phantom-auth.test.ts`
needs a different method to stub.

---

## Companion change artifacts

This folder is `phantom-auth-ultimate-fix/`. The full regression-test
contract lives in the sibling change:

- `phatom-auth-repro-with-tests/proposal.md` — test-change motivation
  and impact.
- `phatom-auth-repro-with-tests/design.md` — seam choice
  (`ProfileAuthManager`), mock patterns, baseline-bump risk.
- `phatom-auth-repro-with-tests/specs/phantom-auth-detection/spec.md` —
  the canonical contract for what the fix must satisfy. **Read this
  before writing implementation code.**
- `phatom-auth-repro-with-tests/tasks.md` — implementation checklist.

Both changes share the `phantom-auth-detection` capability. The fix
change's `proposal.md` (this folder) declares the same new capabilities
(`phantom-auth-detection`, `silent-refresh-tightening`) that the test
change defines scenarios for. `openspec archive` will merge them when
both land.

---

## File inventory for the next session

- `openspec/changes/phantom-auth-ultimate-fix/proposal.md` (this folder)
  — bug-report draft (committed at `d744508`).
- `openspec/changes/phatom-auth-repro-with-tests/{proposal,design,specs/phantom-auth-detection/spec,tasks}.md`
  — full test change (committed at `802a84a`).
- `openspec/changes/phantom-auth-ultimate-fix/investigation.md` — **this
  file** — collated findings for the grilling session.
- `C:\dev\projects\github\gemiterm\.gemiterm\profiles\` — copied
  profiles for dev-env repro.
- `C:\Users\diego\.plannotator\plans\plan-phantom-authentication-lo-2026-08-02-approved.md`
  — the original plan deliverable (outside the repo; outside git).