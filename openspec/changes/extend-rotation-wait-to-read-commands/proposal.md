## Why

`await-detached-rotation-on-empty-list` fixes the race for `list` only. The same race hits every read command that arms a stale jar: `fetch`, `export`, `export-all`, and `continue` can fail (RPC auth error or empty read) on a superseded PSIDTS while the detached rotation their own `ensureSession` triggered lands seconds later. ~~This change is intentionally proposal-only until the predecessor's field verification passes on a real session.~~ **Unblocked 2026-08-18:** the gate (`await-detached-rotation-on-empty-list` task 5.1) cleared — see its Round 2 note and the archived `fix-rotation-dead-end` change, which also field-validated the hardened pipeline (single-flight runner spawn, zero playwright collisions, post-rotation renders on previously-phantom profiles).

## What Changes

- Applies the predecessor's proven pattern — `rotationInFlight(profile)` check → stderr notice → bounded `waitForRotation(profile)` → single retry — to the read commands that consume a single profile's session, at each command's already-failing seam:
  - `fetch`: on a failed or empty `fetchChat` for the resolved profile.
  - `export` / `export-all`: on per-conversation fetch failure for that conversation's owning/resolved profile.
  - `continue`: on the initial read or send failure for the target profile.
- Exact seam per command (failure-signal shape differs: `fetch` can return *empty* where `list` returned *zero rows*; `continue`/send surfaces typed `AuthenticationError`) is a design task informed by the predecessor's field results (now recorded: task 5.1 rounds 1–2) — the observed failure mode decides whether the trigger is "empty result", "typed auth error", or both.
- All notices/hints on stderr only; per-command stdout contracts untouched; arm-first semantics untouched; no facade changes expected beyond what the predecessor and `fix-rotation-dead-end` shipped (if the field results demand a facade change, that is a signal to stop and re-propose, not to improvise).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `commands`: ADDED requirement — read commands (`fetch`, `export`, `export-all`, `continue`) await an in-flight detached rotation once, at their failing seam, before surfacing an auth failure or empty read to the user.

## Impact

- `src/cli/commands/fetch-command.ts`, `export-command.ts`, `export-all-command.ts`, `continue-command.ts` (command layer only — outside `AUTH_SENSITIVE_PATHS` globs, but the content regex (`CookieSession` imports) will trigger the auth gate; same-change `tests/auth-regression/` or documented opt-out required if any `src/auth/**` file is touched).
- Tests mirroring the predecessor's: per-command integration tests for wait/retry/fall-through, plus the byte-output contracts each command already pins.
- ~~Blocked-by: `await-detached-rotation-on-empty-list` task 5.1 (manual field verification).~~ Cleared 2026-08-18. Facade facts to consume (post `fix-rotation-dead-end`): `waitForRotation` default timeout is now **90 s** (>= the runner's 60 s rotate budget; tuned through exactly the "tune it in the predecessor's facade first" path this change required); the detached spawn is single-flight cross-process (`refresh-runner.lock`), so concurrent read commands will not stack runners; and `CookieSession.recover` now awaits an in-flight rotation itself before opening a recovery browser — this change still consumes, not extends, that surface.
