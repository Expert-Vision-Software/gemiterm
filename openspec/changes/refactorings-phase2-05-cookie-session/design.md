## Context

Phase-2 refactorings #2–#5 have landed (archived `2026-08-14-refactorings-phase2-01..04`). Every command is now a thin adapter over a `CommandContext`; the remaining architectural debt is the cookie lifecycle itself, scattered across five modules (`cookie-storage-service.ts`, `gemini-client-wrapper.ts`, `storage.ts`, `auth-service.ts`, `profile-auth-manager.ts`) with the duplication inventory listed in the proposal.

Scope was set by an item-by-item review grill: consolidate structurally, then fix the bounded set of faulty behaviors the consolidation exposes. Behaviors that are merely quirky-but-correct stay untouched (D7 records the one rejected "improvement").

Constraints:

- **`gemini-web-sdk` has no rotation API.** It exposes a public `cookies: Record<string, string>` jar that it passively absorbs from `Set-Cookie` response headers (`node_modules/gemini-web-sdk/src/gemini.js:406,588,636,960`). Rotation must be a direct in-repo HTTP call.
- **Rotation endpoint precedent.** Upstream `HanaokaYuzu/Gemini-API` (`rotate_1psidts`) refreshes `__Secure-1PSIDTS` via `POST https://accounts.google.com/RotateCookies` — simple JSON body, no batchexecute envelope — and it requires only the long-lived `__Secure-1PSID`; the rotated `__Secure-1PSIDTS` arrives as a `Set-Cookie` header; a 60-second cache prevents excessive rotation. This is the design's rotator basis (verified via DeepWiki against the upstream repo).
- **Auth is the sensitive area.** `AGENTS.md` names `auth-service.ts`, `cookie-storage-service.ts`, `playwright-cli-driver.ts`, `cookie-monitor.ts` as the regression gate; the service-level tests in `tests/services/` are the contract.
- **On-disk format is frozen.** The `{ cookies: Cookie[] }` profile JSON layout must continue to load and be written (v1.4.1 → v2.x upgrade path). `expires` *values* on tracked cookies change per D5 (stamping) — the layout does not.
- **Path mediation.** The new module lives in `src/services/` and consumes `infrastructure/io.ts`/`path-utils.ts` only through `CookieStorage`; no new `node:fs`/`node:path` imports.

## Goals / Non-Goals

**Goals:**

- One deep `CookieSession` module behind `ensureSession(profile)` (only load path) and `commit(...)` (only persistence path) — the seam every future cookie fix targets.
- Fix the four enumerated faulty behaviors: PSID-less captures silently saved; short-TTL captures landing pre-expired; identical re-captures distorting mtime/`lastUsedAt`; stale sessions recoverable only by full browser re-auth.
- Single homes: one `COOKIE_EXPIRY_THRESHOLD_MS`, both preserved expiry semantics, one validation tier model, zero cookie-name magic strings outside the module.
- Delete `CookieStorageService` and all duplicated validation/freshness/expiry helpers.
- Injectable clock and rotator; rotation gated so the change is safe to land before the live envelope is verified.

**Non-Goals:**

- Switching the auth "Session expires" line to max-over-both expiry — rejected (D7).
- Touching `cookie-monitor.ts` or `playwright-cli-driver.ts`; background/scheduled rotation daemons; OAuth flows.
- Changing the on-disk JSON layout, CLI flags, or any error message other than the new fail-fast capture error.
- Rotation retries/backoff beyond one attempt per `ensureSession` plus the min-interval cache.

## Decisions

### D1: Module shape — one class, two public methods, one public read helper

```ts
class CookieSession {
  async ensureSession(profile: string): Promise<ActiveSession>   // only load path
  commit(profile: string, entries: Cookie[]): void               // capture-mode persistence
  commit(profile: string, jar: { jar: Record<string, string> }): void // jar-merge persistence
  sessionStatus(profile: string): SessionStatus                  // pure read for status callers
}
```

`ActiveSession` = `{ cookies: Cookie[], secure1psid, secure1psidts, expiresAt: Date | null }`. `commit` is synchronous (mirrors today's `writeTextFile` semantics); `ensureSession` is async because the ladder may POST (rotation disabled → resolves without network).

*Alternative considered:* keeping `CookieStorageService` under a coordinator — rejected: preserves the shallow module and leaves two public load surfaces.

### D2: Two-tier validation with today's boolean outcomes

Tier 1 (primary): non-empty `__Secure-1PSID` — terminal. Tier 2 (secondary): non-empty `__Secure-1PSIDTS`, `expires > 0`, expiry later than `now + 7 days` via the injected clock — recoverable. Equivalence pinned: both tiers pass ⇔ today's `validateCookies && checkCookieFreshness`. The tier split equips the ladder (D4) to distinguish terminal from recoverable. All pre-existing error messages preserved byte-identically (`Missing required cookie __Secure-1PSID`, `appears expired`, `No valid session for profile '<name>'` + `gemiterm login`); the only new message is the fail-fast capture error (D5).

### D3: Recovery ladder — 4 rungs, typed, inside `ensureSession`

(1) Trust persisted when both tiers pass. (2) Rotate — `POST https://accounts.google.com/RotateCookies` with the PSID-bearing jar; on success `commit` the rotated `__Secure-1PSIDTS`. (3) Absorb — `commit` a caller-supplied live jar when it holds newer tracked values (unreachable this change: no caller supplies one; wired for the wrapper's future use). (4) Fail — `AuthenticationError` naming the profile and failing binding, pointing at `gemiterm auth`. (Fixed order when rotation is enabled: rotate before absorb, since rotate needs only the primary binding while absorb depends on a live jar that callers may not have. With rotation disabled — the shipped default — rungs 2/3 are inert and the observable behavior is today's load → validate → throw-or-return.)

Each rung logs at debug. A failed rung falls through; a failed rotation never invalidates a tier-2-valid session.

### D4: In-repo rotator — accounts.google.com/RotateCookies, gated

- Endpoint: `POST https://accounts.google.com/RotateCookies`; headers `Content-Type: application/json`, `Origin: https://accounts.google.com`, `Cookie` built from the tracked values (upstream sends `__Secure-1PAPISID` etc. as available; PSID is the required one). Response delivers the rotated `__Secure-1PSIDTS` via `Set-Cookie`; parse from response headers, fall through on absence.
- Rate limits: at most one attempt per `ensureSession`; a per-profile min-interval cache (upstream uses 60 s) suppresses repeated attempts.
- **Gate:** ships disabled by default. The live envelope (exact body/headers for current Google backend) is captured once against a real session at implementation time before enabling. Until then the ladder degrades to pre-change behavior. Failure semantics (network/5xx/missing PSIDTS) count as a failed rung only.

*Alternative considered:* the `gemini.google.com/...BardFrontendService/RotateCookies` batchexecute form — the upstream evidence shows the accounts.google.com form is the maintained one; the capture gate arbitrates at implementation time if the simple form is rejected.

### D5: `commit` — single persistence path; capture mode gains gating + stamping + skip

`CookieStorage.save` becomes callable only from `CookieSession`. Two modes:

- **Capture mode** (`entries: Cookie[]`, from `AuthService.extractCookies`):
  - *Gate (fix #1):* merged set must pass tier 1 (usable `__Secure-1PSID`); otherwise throw the new actionable error (`__Secure-1PSID missing from captured cookies — retry 'gemiterm auth'`) and leave disk untouched. Replaces the silent partial save.
  - *Stamp (fix #2):* tracked entries' `expires` set to `now + COOKIE_EXPIRY_THRESHOLD_MS` (the wrapper's existing model), so captures with browser-provided short-TTL PSIDTS no longer land pre-expired. Untracked entries pass through verbatim with their metadata.
  - *Skip (fix #3):* if the persisted set already equals the incoming stamped entries (same names/values/expires), no write — mtime preserved, `lastUsedAt` honest.
- **Jar-merge mode** (`{ jar }`, from `GeminiClientService`): behavior identical to today's wrapper internals — overlay jar values onto persisted entries preserving metadata and untracked names, stamp `expires` `now + 7d`, write; caller retains changed-since-last-commit detection; failures logged at debug, never fail the API operation.

*Alternative considered:* stamping with the server-provided `expires` when present — rejected: the response `Set-Cookie` TTL reflects Google's rotation cadence (~600 s), not our 7-day freshness model; mixing the two recreates the phantom-capture bug the stamp fixes.

### D6: Both expiry semantics preserved, one home

- `sessionExpiry(cookies)` — max positive `expires` across `__Secure-1PSID` + `__Secure-1PSIDTS` (today's `storage.ts:25`; consumed by `ProfileManager.getStatus` and `ActiveSession.expiresAt`).
- `psidtsExpiry(cookies)` — `__Secure-1PSIDTS`-only read (today's `cookie-storage-service.ts:68` / `auth-service.ts:187`; consumed by the auth confirmation line — now the stamped capture+7d value).

Three implementations in three files → two semantic functions in one module.

### D7: REJECTED — max-over-both expiry on the auth "Session expires" line

<!-- Considered and rejected in review: showing max(__Secure-1PSID, __Secure-1PSIDTS) expiry on the auth confirmation line. __Secure-1PSIDTS is the binding that actually gates usability (it is what rotation exists to refresh); the long-lived __Secure-1PSID's months-long date would overstate session health and hide the very staleness this module manages. The line keeps psidtsExpiry (D6). Do not "fix" this without revisiting the whole PSIDTS lifecycle. -->

Kept here as an explicit flag so future work doesn't silently reverse it.

### D8: Injectable clock

`CookieSessionDeps = { cookieStorage, logger, clock? (default `Date.now`), rotator? (default gated RotateCookies POST) }`. All freshness/stamp/rotation-window decisions route through `clock` — rotation timing and the 7-day threshold become table-driven unit tests.

### D9: Wiring — `CommandContext`, not a service locator

`src/cli/index.ts` constructs `CookieSession` once (replacing the `CookieStorageService` construction at `:34`) and injects it wherever `cookieStorageService` flowed. `GeminiClientService` keeps its optional-deps constructor pattern (`"_test"` marker) — wrapper tests stub `session.commit`.

### D10: One comprehensive change, golden-gated on the unchanged surface

The single-path invariant only holds if every writer and reader migrates in the same pass. The enumerated user-visible changes (fail-fast, stamped expiry line, skip-unchanged mtime) are the *only* accepted diffs; everything else is golden-tested byte-identical: status/list output, `ProfileManager` error messages, wrapper persistence timing, on-disk layout (modulo stamped `expires` values on tracked entries).

## Risks / Trade-offs

- [Rotation endpoint drift / bot-flagging] → Gated (disabled until live-capture verification); one attempt max + min-interval cache; failed rotation never invalidates a working session; single-module home makes drift a one-file fix.
- [Stamping masks a truly dead session for up to 7 days] → Accepted: the freshness model is ours, not Google's; rotation (once enabled) refreshes reality on next `ensureSession`; tier-1 hard failures still fail fast.
- [Fail-fast changes an existing reachable path] → The old path produced a guaranteed-broken session; new error is actionable; CHANGELOG documents it.
- [Sensitive-area regressions] → Re-read `tests/services/auth-service.test.ts` + new `cookie-session.test.ts` before committing; `cookie-monitor.ts`/`playwright-cli-driver.ts` untouched (`git diff --stat` gate).
- [Test-count baseline moves] → Replace `cookie-storage-service.test.ts` with `cookie-session.test.ts`; update open changes' baselines.

## Migration Plan

Single implementation session:

1. Create `cookie-session.ts` + unit tests (no callers) — additive.
2. Switch writers (wrapper + auth capture) → `commit`; run service tests + goldens.
3. Switch readers (`ProfileAuthManager`, `ProfileManager`) → session functions; run storage/auth tests + console goldens.
4. Delete `cookie-storage-service.ts`, `storage.ts` helpers, duplicate constants; rewire `cli/index.ts`.
5. Rotation live-capture gate; enable behind the flag; full `bun test` + `typecheck` + `bash scripts/lint-path-mediation.sh`; CHANGELOG entry.

Rollback: revert the commit — layout/CLI unchanged; stamped `expires` values are forward-compatible with the old reader logic (both use the same threshold semantics).

## Open Questions

- Exact live `RotateCookies` body/headers for the current Google backend (resolved by the capture-gate task; upstream's simple JSON form is the hypothesis).
- Whether the min-interval cache should be per-profile on disk or per-process (default: per-process — rotation only happens inside `ensureSession`, which is once per command invocation).
