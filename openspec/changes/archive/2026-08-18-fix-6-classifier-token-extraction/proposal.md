## Why

The session classifier treats *token-key presence* as *token presence*: `SessionClassifier.classifyDetailed` (`src/auth/session-classifier.ts:67`) runs `INIT_TOKENS.some((token) => html.includes(token))` — a substring check on the token **name**. Gemini's signed-out HTML contains the keys with empty values (e.g. `"cfb2h":""`), so a fully signed-out init GET is classified `live`/`phantom` instead of `dead`. Field evidence (2026-08-18, DHBGAMING2): profile `evs-diegohb` — whose persisted jar's `__Secure-1PSIDTS` existed only at the `.youtube.com` scope — probed `✓ live (23)` in `status --verbose` via the SDK fallback, while `fetch` on the same jar was rejected by the validator. Every downstream consumer of the classifier (`status`, `activeProfiles`, conversation routing, fix-8's wait-then-reclassify) inherits a verdict that can be wrong in the safest-looking direction: declaring a broken session healthy.

The ablation study already established the correct predicate (docs/auth-cookie-lifecycle.md §6.2, [VALIDATED]): tokens are extracted by value regexes (`/"SNlM0e":\s*"(.*?)"/` etc.) and **all-empty extracted values ⇒ signed out ⇒ dead**. The implementation just never used it.

## What Changes

- `SessionClassifier` extracts init-token **values** via the ablation §6.2 regexes instead of substring-checking token names; `dead` is classified when no required token yields a non-empty extracted value.
- `INIT_TOKENS` (token-name list in `src/auth/auth-constants.ts`) is replaced or accompanied by an extraction table (`SNlM0e`, `cfb2h`, `FdrFJe`) usable by both the classifier and any future init-HTML consumer; the token-name `includes` scan is deleted.
- No behavior change for genuinely-token-bearing HTML: `live`/`phantom` split (chats ≥ 1 vs 0) is untouched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth`: `CookieSession.probe classifies live, phantom, or dead` — the "init GET yields/extracts session tokens" predicate becomes value-based (non-empty regex-extracted value), so token keys with empty values classify `dead`.

## Impact

- Code: `src/auth/session-classifier.ts` (token check), `src/auth/auth-constants.ts` (extraction table), `src/core/types.ts` only if a token-value map type is exported.
- Tests: `tests/auth-regression/` (auth-sensitive path — gate requires it), existing classifier unit tests updated from name-presence fixtures to value fixtures.
- Docs: `docs/auth-cookie-lifecycle.md` changelog entry (auth-sensitive path rule).
- Sequencing: first of three fixes (`fix-6` → `fix-7-capture-gate-routability` → `fix-8-stale-profile-reachability`); fix-8's reclassify-after-rotation depends on this honest classifier.
