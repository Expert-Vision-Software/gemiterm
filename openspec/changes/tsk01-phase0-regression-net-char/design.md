## Context

The phantom-auth saga (v2.6.0 → `0f9154f`) shipped green tests at every commit but regressed at each step: the capture trim (`6bc51f6`), the throttle defeat (`a780788`), the 401-not-surfaced (`4dfe13c`), the L2 corruption (`9762845`), the continue-chat regression (`809240a`), and the targeted-L2 recovery (`0f9154f`). Every fix passed its unit tests but failed in the real integration because the stub at the `IGeminiClientService` seam was idealized.

Phase 0 pins a characterization test at the `ProfileAuthManager` integration boundary using a realistic in-memory fixture and a **cookie-aware fake** — a test double that reads the actual cookie jar to decide what API responses to return, so the test exercises the same path the real system does: if companions are absent, `listChats` returns empty.

## Goals / Non-Goals

**Goals:**
- Prove the round-trip works when the jar is complete.
- Prove the round-trip fails when the jar is trimmed (phantom-auth state).
- Prove profile routing (cookies from the right profile).
- Prove conversation threading (sendMessage → fetchChat returns the same turn).
- Provide a reusable `full-stack-fixture.ts` module for Candidate A/B/C/D tests.

**Non-Goals:**
- Test the `CookieMonitor` capture path (that's a unit-test concern).
- Test time-passing via rotation throttle (requires `now()` injection into `CookieStorage` — deferred to Candidate A).
- Test real-SDK smoke (requires live credentials — deferred to Candidate A).

## Decisions

### D1. Fixture at the `ProfileAuthManager` seam

**Choice:** `buildFullStack` assembles real `CookieStorage`, `ProfileManager`, `CookieStorageService`, and `ProfileAuthManager` with a cookie-aware fake `IGeminiClientService`. The fake inspects the real cookie jar (via `CookieStorageService.loadAllCookiesForProfile`) to decide `listChats` behavior.

**Rationale:** Testing at the `ProfileAuthManager` seam is the highest-level integration point reachable without accessing the un-exported `setupMediator` and `getGeminiClient` closures in `cli/index.ts`. The `ProfileAuthManager.ensureAuthenticated` + `GeminiClientService.forProfile.*` path is the same one every command uses.

**Alternatives considered:** Testing through `setupMediator` directly (requires exporting the function — a `src/` change not allowed in Phase 0), testing at individual API call level (doesn't exercise the `ensureAuthenticated` gate).

### D2. Cookie-aware fake pattern

**Choice:** The fake `IGeminiClientService` wraps the existing `gimme(modelsFn)` pattern from `tests/services/phantom-auth.test.ts` with a `listChats` implementation that reads the real cookie jar and returns 1 chat iff companion cookies are present.

**Rationale:** The `gimme` pattern is already proven (used in 4 test files). Adding cookie-awareness makes the fake "real enough" to surface the phantom-auth symptom (models works, listChats empty) without needing a live Gemini session.

**Alternatives considered:** A real `GeminiClientService` with mocked `gemini-web-sdk` (too complex — requires mocking the entire SDK lifecycle), a purely static fake (would never surface phantom-auth).

### D3. Companion cookie set

**Choice:** The fake checks for the presence of any companion cookie from the set `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `SIDCC`, `__Secure-3PSID`, `NID`. If at least one is present in the jar, `listChats` returns a chat; otherwise empty.

**Rationale:** The `listChats` RPC requires companion cookies for enumeration. Checking for the presence of any companion is a faithful simulation of the server's behavior, confirmed by empirical testing (the 4-cookie discovery).

### D4. Conversation threading via chatMetadata

**Choice:** The fixture includes a `ChatMetadataStorage` instance. The regression-net test seeds metadata (rid/rcid) and verifies that `sendMessage(cid)` followed by `fetchChat(cid)` returns the same conversation turn.

**Rationale:** The continue-chat regression (`809240a`) was caused by missing `rid`/`rcid` in the metadata array. Testing the metadata pipeline (storage → lookup → sendMessage) directly exercises the threading contract.

## Risks / Trade-offs

- **[Risk]** The cookie-aware fake doesn't exercise `persistRefreshedCookies` (the SDK self-rotation path). → **Mitigation:** The `persistRefreshedCookies` contract is tested separately in `tests/services/phantom-auth.test.ts`. Phase 0 focuses on the round-trip shape, not the SDK internals.
- **[Risk]** The fake's `forProfile` returns `this` (identity), which means multi-profile routing is tested only at the jar-seed level (different profiles have different cookies). → **Mitigation:** Acceptable for Phase 0. Candidate A will add a `forProfile` that actually loads the target profile's cookies.

## Migration Plan

N/A — Phase 0 is test-only. No production code changes.

## Open Questions

- Whether `tests/helpers/` should use the existing `tests/fixtures/` patterns or define its own. Decision: `tests/helpers/` is for the fixture (a test infrastructure module); `tests/fixtures/` is for data factories. Keep them separate.
