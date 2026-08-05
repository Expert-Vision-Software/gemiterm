## Context

The current probe in `ProfileAuthManager.probeServerSession` calls `geminiClient.listChats({ limit: 1 })` and classifies the result: non-empty → valid, empty + marker → stale, empty + no marker → ambiguous. Research (#12) proved `[]` is a 3-way ambiguous signal: the SDK silently maps degraded auth (null `SNlM0e`, PSIDTS mismatch) to `[]`, so `[]` is not a reliable staleness signal. The reference implementation (notebooklm-py) explicitly guards against "empty = stale" with a ratchet test. The probe must be replaced with a definitive positive liveness check — `models()`, the gemini-web-sdk's model-listing RPC, which is the cheapest RPC that requires a valid session. The `profile-has-chats` marker, which existed solely to disambiguate `[]`-stale from `[]`-genuine, is retired.

## Goals / Non-Goals

**Goals:**
- Replace `listChats({ limit: 1 })` with `models()` in `probeServerSession`
- Simplify probe classification from 3 branches to 2 (valid, stale — no "ambiguous")
- Remove `profile-has-chats` marker: `writeProfileHasChats`, `readProfileHasChats`, `getProfileHasChatsPath`
- Update the `phantom-auth-detection` spec scenarios
- `ensureAuthenticated` behavior unchanged apart from the probe call

**Non-Goals:**
- Adding `AuthError`-on-degraded-session to `gemini-web-sdk` (deferred follow-up)
- Changing `autoExtendSession` or the L1→L2 recovery ladder
- Clock injection (already decided as minimal injectable `Clock` in #16; not needed for this proposal's probe change)
- The data-integrity fixes (B2 + B3 — those are Proposal A)

## Decisions

### Decision 1: `models()` vs. `init()` access-token check

**Chosen:** `models()` RPC. The SDK's `init()` extracts `SNlM0e` but never validates it — null `SNlM0e` + valid `cfb2h`/`TuX5cc` proceeds silently. Checking `SNlM0e` after `init()` requires peeking into internal state the SDK doesn't expose.

**Alternative considered:** Inspect `SNlM0e` from the SDK's internal auth state. Rejected — the SDK's `_ensure()` method doesn't return the token, and reaching into `this.accessToken` is fragile against SDK upgrades.

**Alternative considered:** Transport-level check (302→login, 401, 403 on batchexecute). Rejected — the SDK swallows these into graceful `[]` returns; intercepting them requires SDK fork changes (deferred follow-up).

### Decision 2: Simplified classification (2 branches)

Current: valid | stale | ambiguous. New: valid | stale.

- `models()` succeeds → "valid" (cache + return)
- `models()` throws → "stale" (trigger silentRefresh)
- No "ambiguous" branch — a failed RPC is definitive proof of session problems

The probe cache TTL (`GEMITERM_PROBE_TTL_MS`, default 150s) is preserved unchanged.

### Decision 3: Marker retirement

The `profile-has-chats` marker was a workaround for `[]` ambiguity. With `models()` as the probe, it serves no purpose. Remove:
- `writeProfileHasChats` / `readProfileHasChats` from `src/infrastructure/io.ts`
- `getProfileHasChatsPath` from `src/infrastructure/path-utils.ts`
- All marker reads/writes in `probeServerSession`
- Leave existing marker files on disk (harmless zero-byte files; no cleanup migration needed)

## Risks / Trade-offs

- [Risk] `models()` RPC may 200-OK while `listChats` returns `[]` — a valid session with null chat-list. This is the *desired* behavior: the probe answers "is the session alive?", not "are there chats?". → Mitigation: this is by design; `gemiterm list` shows `0 chats` as a valid result, not a staleness signal.
- [Risk] `models()` RPC costs a network round-trip per probe → Mitigation: probe cache (150s TTL) unchanged; no additional latency in practice. `models()` returns a small payload (~1KB) vs. `listChats` which can be large.
- [Risk] Removing marker helpers breaks the `io.ts` single-call-site rule enforced by CI → Mitigation: `readProfileHasChats` / `writeProfileHasChats` each have 2+ call sites (in `profile-auth-manager.ts` and `profile-auth-manager.test.ts`). If the helper removal drops call sites below 2, either inline or ensure the remaining callers are enough. This is addressed in tasks.
