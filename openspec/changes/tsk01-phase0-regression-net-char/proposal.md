## Why

Every prior phantom-auth fix shipped green but burned live. The reason is that no test wires the real service stack end-to-end — every test stubs at the service seam. Phase 0 closes this by pinning an assertion contract at the `ProfileAuthManager` + `GeminiClientService` integration boundary.

## What Changes

- New `tests/helpers/full-stack-fixture.ts` exporting `buildFullStack({ profileName, seedCookies, logger })`.
- New `tests/services/regression-net.test.ts` covering:
  - **Round-trip:** `ensureAuthenticated → listChats → sendMessage(cid) → fetchChat(cid)`
  - **Jar completeness** at every step (companions + PSID + PSIDTS present)
  - **Conversation threading:** `fetchChat(cid)` returns the turn added by `sendMessage(cid)`
  - **Profile routing:** `ensureAuthenticated` for a named profile returns cookies from that profile
  - **Phantom-auth detection:** with a trimmed jar (no companions), `listChats` returns empty while `models` succeeds — the exact phantom-auth state
- OpenSpec delta to `openspec/specs/phantom-auth-detection/spec.md`: new requirement pinning the regression net contract.

## Capabilities

### Modified Capabilities

- `phantom-auth-detection` — add a `Requirement: Phase-0 regression net pins round-trip behavior` requirement that asserts the full round-trip + threading + profile routing + jar-completeness contract.

## Impact

- Code touched: `tests/helpers/full-stack-fixture.ts` (new), `tests/services/regression-net.test.ts` (new), `openspec/specs/phantom-auth-detection/spec.md` (delta).
- No production code changes.
- `package.json` deps: none.
- Test count: +1 file, ~6-10 tests.
