## ADDED Requirements

### Requirement: Phase-0 regression net pins round-trip behavior at the ProfileAuthManager integration seam

The system MUST have a characterization test suite (`tests/services/regression-net.test.ts`) that verifies the full authentication-to-API round-trip at the `ProfileAuthManager` + `GeminiClientService` integration boundary. The test suite MUST use a reusable fixture (`tests/helpers/full-stack-fixture.ts`) that assembles real `CookieStorage`, `ProfileManager`, `CookieStorageService`, and `ProfileAuthManager` instances with a cookie-aware fake `IGeminiClientService`.

The fixture's fake `IGeminiClientService` MUST:
- Return successful `models()` responses unconditionally
- Return `listChats` results (≥1 chat) ONLY when the in-memory cookie jar contains at least one companion cookie (`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `SIDCC`, `__Secure-3PSID`, or `NID`)
- Return empty `listChats` results when companion cookies are absent
- Support `sendMessage(cid)` that returns a fixed response string
- Support `fetchChat(cid)` that returns a conversation turn with known `rid`/`rcid` values
- Expose a `teardown()` method that cleans up temporary storage

The characterization tests MUST assert:
- **Full-jar round-trip:** when the cookie jar contains PSID + PSIDTS + companions, `ensureAuthenticated` succeeds and `listChats` returns ≥1 chat
- **Phantom-auth detection:** when the cookie jar contains only PSID + PSIDTS (no companions), `models` succeeds but `listChats` returns empty
- **Profile routing:** `ensureAuthenticated("profileA")` returns cookies from profile A's jar, not profile B's
- **Jar completeness:** after `ensureAuthenticated` completes, the cookie jar still contains PSID + PSIDTS + companions (no corruption)
- **Conversation threading:** `sendMessage(cid)` followed by `fetchChat(cid)` returns a conversation turn with `rid`/`rcid` values matching the round-trip's expected metadata

#### Scenario: Full jar round-trip succeeds

- **WHEN** a full cookie jar (PSID + PSIDTS + 7 companions) is seeded for profile "test"
- **AND** `ProfileAuthManager.ensureAuthenticated("test")` is called
- **AND** `cookieAwareFake.listChats()` is called
- **THEN** `ensureAuthenticated` returns `LoadedCookies` with the seeded values
- **AND** `listChats` returns at least 1 chat
- **AND** the post-call cookie jar still contains all seeded companions

#### Scenario: Trimmed jar triggers phantom-auth state

- **WHEN** a trimmed cookie jar (PSID + PSIDTS only, no companions) is seeded
- **AND** `ProfileAuthManager.ensureAuthenticated()` is called
- **AND** `cookieAwareFake.models()` is called (succeeds)
- **AND** `cookieAwareFake.listChats()` is called
- **THEN** `models` succeeds (server-side probe reports "valid")
- **AND** `listChats` returns empty (no chats — the phantom-auth symptom)

#### Scenario: Profile routing returns correct profile's cookies

- **WHEN** two profiles ("alpha" and "beta") are seeded with different cookie values
- **AND** `ProfileAuthManager.ensureAuthenticated("alpha")` is called
- **THEN** the returned `LoadedCookies.secure_1psid` matches alpha's seeded PSID value
- **AND** the returned cookies do NOT match beta's seeded values

#### Scenario: Jar completeness preserved after ensureAuthenticated

- **WHEN** a full cookie jar is seeded for a profile
- **AND** `ProfileAuthManager.ensureAuthenticated()` is called and returns successfully
- **THEN** `CookieStorageService.loadAllCookiesForProfile()` returns the same number of cookies as were seeded
- **AND** every companion cookie name is still present in the jar

#### Scenario: Conversation threading round-trip

- **WHEN** a full cookie jar is seeded
- **AND** `ensureAuthenticated()` succeeds
- **AND** `sendMessage("cid-1", "hello")` is called and returns a response
- **AND** `fetchChat("cid-1")` is called
- **THEN** the fetched conversation turn has a known `rid` and `rcid`
- **AND** the fetched turn content matches the sendMessage response
