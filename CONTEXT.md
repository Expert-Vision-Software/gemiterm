# Domain Glossary — GemiTerm

Stable terminology for the auth and conversation modules. No implementation details; see source and specs for those.

---

## Auth concepts

### Cookie jar
The persisted collection of authentication cookies for a single profile, stored at `%APPDATA%\gemiterm\profiles\<name>\cookies.json` (Windows) or `~/gemiterm/profiles/<name>/cookies.json` (POSIX). Contains the long-lived identity cookie (`__Secure-1PSID`), the short-lived session cookie (`__Secure-1PSIDTS`), and companion auth cookies (`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-3PSID`, `SIDCC`, etc.). All API operations ultimately read from this jar.

### cookiesLocalValid
A profile whose on-disk jar exists, contains `__Secure-1PSID` + `__Secure-1PSIDTS`, and whose PSIDTS `expires` field is not within the freshness-threshold of expiring. Purely local — no network I/O. This is the only check v2.4.0 performs; it is deterministic. The threshold is configurable (7 days in v2.4.0, 1 hour in HEAD [change `7e2c486`]).

### cookiesRemoteValid
A profile whose cookies are accepted by a live Gemini API call (currently `models()`). Depends on network, server-side session state, and rate limits — probabilistic, not deterministic. Introduced post-v2.4.0 as the **probe** concept. A session can be `cookiesLocalValid` but not `cookiesRemoteValid` (server-side rotation made PSIDTS stale, network error, etc.), and this asymmetry is the root of the probe-induced death-spiral.

### Phantom-auth session
A session state where `models()` succeeds (the PSID is server-accepted) but `listChats` returns empty. Previously attributed to missing companion cookies; **empirically disproven 2026-08-10** — a 4-cookie jar (PSID + PSIDTS only, no companions) returns full chat lists on both v2.4.0 and HEAD. The actual cause of phantom-auth remains unconfirmed. Distinguished from a **dead session** (RotateCookies returns 401/403) and a **fresh session** (every probe passes).

### Companion cookies
Auth cookies set alongside `__Secure-1PSID` and `__Secure-1PSIDTS` during the Google login envelope: `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-3PSID`, `__Secure-3PSIDTS`, `SIDCC`, `NID`. **Previously believed required by `listChats` — disproven 2026-08-10.** A 4-cookie jar (no companions) returns full chat lists. The functional role of companion cookies is currently unknown.

### Probe death-spiral
The failure mode where `ensureAuthenticated`'s server probe (`models()`) returns "stale" (for any reason: network blip, transient server rejection, rate limit), triggering silentRefresh which itself fails (frontend-valid session produces identical cookies → no rotation detected → returns false), and the session is killed with `AuthenticationError`. The probe transforms a potentially-viable session into a dead one — destructive validation. v2.4.0 avoids this entirely by never probing.

### PSID-only probe
A server-side validity check using `models()` which succeeds with only `__Secure-1PSID` present. Insufficient as the sole auth gate because it cannot detect phantom-auth. See **Probe cache** below.

### Probe cache
A per-process, TTL-bounded memoization of the most recent `models()` probe result per profile (default 150 000 ms, overridable via `GEMITERM_PROBE_TTL_MS`). Distinct from the on-disk freshness check, which is purely local. Does NOT cache the `listChats` result; the phantom check re-issues on every L1-decline path.

### Recovery ladder
The escalation sequence `ensureAuthenticated` follows when its probe says "stale" or its rotation says "declined": L1 `RotateCookies` POST → targeted L2 silent refresh (when phantom is detected) → throw `AuthenticationError` to surface to headed reauth. Each rung has different failure modes; the ladder is the policy that maps session state to action.

---

## Auth-flow control

### Cookie capture path
The sequence by which cookies enter the persisted jar: headed browser → `playwright-cli` probe → `CookieMonitor` callback → `AuthService.extractCookies` → `CookieStorageService.saveCookiesForProfile`. Trimming anywhere in this path is a capture-integrity bug.

### Cookie rotation
A POST to `https://accounts.google.com/RotateCookies` with the current `.google.com` cookie header, asking Google for a fresh `__Secure-1PSIDTS`. Returns 200 with refreshed Set-Cookies; 401/403 if the session is server-dead. Throttled per-process to 600 s.

### Silent refresh (L2)
A headless-browser session that captures a fresh PSIDTS via the cookie-capture path without user interaction. Two modes: `full` (replaces jar via merge) and `targeted` (updates only PSIDTS-family cookies). The targeted mode exists because the full mode was found to corrupt the login's aligned cookie envelope.

---

## Conversation concepts

### Conversation threading
The property that a `sendMessage(cid)` call extends an existing conversation rather than starting a new one. Requires the SDK's positional metadata array `[cid, rid, rcid, null, null, null, null, null, null, ctx]` to carry `rid` and `rcid` from the conversation's last model turn. See [AGENTS.md](../AGENTS.md) for the session-metadata history.

### Chat metadata
A small per-conversation record `{ rid, rcid, ctx }` stored at `%APPDATA%\gemiterm\profiles\<name>\chat-metadata.json`. The `rid`/`rcid` slots are required for threading; `ctx` is a context-token slot used by some Gemini operations. Currently the metadata array layout leaks across 5 call sites — see Candidate B.

### Profile
A named collection of (cookies, chat metadata, conversation history) under a single Google login. Multiple profiles may coexist (`gemiterm auth -e <name>`); `getDefaultProfileName()` returns the active one.

---

## Test-layer concepts

### Regression net
A characterization-test layer that pins behaviour at the integration boundary (the seam where callers meet services), so internal restructuring cannot silently reintroduce known regressions. Distinct from per-method unit tests (which pin implementation) and from mediator-mocked CLI integration tests (which pin argv dispatch). Phase 0 of the auth-path architecture review is the regression net for the auth + chat modules.

### Cookie-aware fake
A test double at the `GeminiClientService` seam whose responses depend on the on-disk cookie jar's contents — specifically, `listChats` returns chats iff the jar carries the companions `listChats` requires. Replaces a ~1 h server-degradation wait with an instant local repro. Pattern established in `tests/services/cookie-jar-repro.test.ts` (commit `efab987`).

### Capture-trim bug
The historical defect (closed by commit `6bc51f6`) where `CookieMonitor` filtered the browser jar to `REQUIRED_COOKIES` before invoking the persistence callback, causing downstream `saveCookiesForProfile` to overwrite a full 39-cookie jar with a 4-cookie subset. The regression-net test for capture-integrity must assert the post-capture jar contains companions.

---

## See also

- `docs/phantom-bug-synthesis.md` — full investigation history; the authoritative source for "what the bug actually was"
- `openspec/specs/auth/spec.md` — committed requirements; the canonical specification
- `openspec/specs/phantom-auth-detection/spec.md` — capability spec for the probe contract
- `openspec/specs/silent-refresh-tightening/spec.md` — capability spec for silentRefresh
- `openspec/changes/archive/2026-08-07-cookie-jar-integrity/` — archived change; the capture-fix provenance
