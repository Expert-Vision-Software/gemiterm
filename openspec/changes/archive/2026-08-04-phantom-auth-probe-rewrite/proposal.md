## Why

The v2.6.0 `phantom-auth-detection` spec rests on a falsified premise: `listChats([])` + `profile-has-chats` marker = stale session. Research (#12) proved `[]` is a 3-way ambiguous signal the gemini-web-sdk never raises an `AuthError` on — it silently returns `[]` for degraded auth, genuine-empty accounts, and parser shape misses alike. The reference implementation (notebooklm-py) has a guardrail test explicitly forbidding this "empty = stale" classification. The probe must be replaced with a positive, deterministic liveness signal that avoids the ambiguity entirely. The `profile-has-chats` marker, which exists only to disambiguate `[]`-stale from `[]`-genuine, becomes moot and is retired.

## What Changes

- **Probe replaced with `models()` RPC.** `probeServerSession` currently calls `listChats({ limit: 1 })`. Replace with `models()` — the gemini-web-sdk's model-listing RPC, which is the cheapest definitive positive liveness signal (no user content, no token cost). Success = session valid. Failure = stale.
- **`profile-has-chats` marker retired.** The marker was only needed to distinguish `[]`-stale from `[]`-genuine. With a positive liveness signal that directly answers "valid or not," the marker has no purpose. Remove `writeProfileHasChats`, `readProfileHasChats`, and `getProfileHasChatsPath`.
- **Spec rewrite.** The `phantom-auth-detection` spec is rewritten from the ground up: probe RPC changes, classification logic simplifies (no ambiguous branch), marker requirement removed.

## Capabilities

### New Capabilities

(none — this rewrites an existing capability)

### Modified Capabilities

- `phantom-auth-detection`: **rewrite** — replaces `listChats`-based empty-list probe with `models()` RPC liveness check. Retires the `profile-has-chats` marker file, probe-cache TTL env var, and the "ambiguous" classification branch. Reduces from 6 probe scenarios to 3 (valid, stale, error).
- `auth`: `ProfileAuthManager.ensureAuthenticated` probe path updated to use `models()` instead of `listChats`. `autoExtendSession` behavior unchanged (still triggers `silentRefresh` on stale classification).

## Impact

- **Code touched:** `src/services/profile-auth-manager.ts` (probeServerSession rewrite), `src/infrastructure/io.ts` (remove marker helpers), `src/infrastructure/path-utils.ts` (remove marker path)
- **APIs / public surface:** `LoadCookies` unchanged. `SilentRefreshFn` unchanged. No breaking changes.
- **Dependencies:** none new
- **SDK follow-up:** Deferred ticket on `gemini-web-sdk` to add `AuthError`-on-degraded-session to the SDK itself, collapsing the gemiterm-side probe to a try/catch.
- **Conformance:** `gemiterm list` non-interactive output unchanged
