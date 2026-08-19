# Design: fix-5-audit-remediations

## Context

The 2026-08-17 post-landing audit verified the CookieSession replacement holds its directives (21 PASS / 2 PARTIAL / 0 FAIL) and surfaced five residual defects: a keepalive fast-path bug, a lost AGENTS.md sensitive-area section, stale legacy references across five main specs, process drift in archived/open changes, and a validity-semantics ambiguity in the storage spec. This change is remediation only - the auth architecture, rotation engine, CAS store, validation tiers, classifier, and recovery rung are untouched.

Relevant history: the AGENTS.md sensitive-area section was added in `ea78f37` (fix-1 task 6.5) and deleted by `67bc148` (`git log -S "state-save" -- AGENTS.md`); fix-4 was archived with tasks 3.4/6.2 unchecked and 6.3 self-contradictory; fix-3's task 3.2 (user-assisted live idle verification) was never run - and could not have passed, because the keepalive fast-path bug (below) means every interval tick spawns a browser.

## Goals / Non-Goals

**Goals:**

- The keepalive loop's no-op fast path works as specified: an unchanged-and-fresh PSIDTS baseline skips the browser.
- The playwright-cli sensitive-area doctrine is documented again in AGENTS.md.
- Five main specs describe the shipped architecture (no `AuthService`/`CookieMonitor`/`ProfileAuthManager`/mediator/`ProfileCommand` references; async `listProfiles`; `login` alias).
- The auth-regression CI gate is blocking; archived task ledgers are honest; `chat-list-bulk-actions` is either re-baselined or explicitly superseded.
- The storage spec distinguishes local display metadata from the session-validity oracle.

**Non-Goals:**

- Any change to auth runtime behavior beyond the keepalive tick's skip eligibility.
- New capabilities, CLI surface changes, or output-byte changes.
- Re-litigating fix-1..fix-4 designs; implementing `chat-list-bulk-actions`.

## Decisions

### D1: Keepalive baseline records the post-rotation value

In `session-keepalive.ts` `tick()`, `currentBaseline` is read from disk *before* the rotation; on success the loop currently stores that pre-rotation value as `lastObservedBaseline`. Since rotation changed the on-disk PSIDTS, every subsequent tick sees disk ≠ baseline, so `fastPathEligible` is unreachable after the loop's first rotation - every 10-minute tick opens a headless browser forever. The fix: on `result.rotated`, set `lastObservedBaseline` from the rotated jar (`findRoutableCookieValue(result.cookies, PSIDTS_COOKIE_NAME)`), falling back to a post-rotation store re-read if the refresher result carries no cookies. The RED test must use a fake refresher that actually mutates the fake store (the existing tests pass precisely because their fakes do not move disk values - the audit's exact finding).

### D2: Spec truth-sync, heading-exact, behavior-preserving

Each stale requirement is MODIFIED in place (exact headings, per the delta convention) to describe current behavior: ContinueCommand/DeleteCommand route ownership through `resolveProfile` -> `context.cookieSession`; AuthCommand delegates to `manageProfiles` forwarding to `captureLogin` (including `{ mode: "renew" }`), is registered with `login` as an alias, and carries the subaction flags; CommandRegistry's context is `{ verbose, cookieSession, profileLifecycle, exportStrategies, getGeminiClient, listProfiles: () => Promise<string[]> }`. ProfileCommand is REMOVED with reason (never implemented - no file, no registration) and migration (auth menu/flags own profile management). Menu text, prompts, and error-message pins are preserved verbatim; implementation tasks must verify each pinned literal against the code before archive (the audit's message quotes - `Error: conversation ID is required.`, `Cancelled.`, `Conversation '<id>' deleted.`, `Continuing with current default profile.`, `Profile '<name>' does not exist.` - are taken from current sources, not memory).

### D3: Restore the AGENTS.md sensitive-area section

Reinstate (from `ea78f37`, verified against the current driver surface) the section documenting: `playwright-cli-driver.ts` as regression-gated (`openHeaded`, `openHeadless` - persistent-profile argv without `--headed`, `stateSave` wrapping `state-save`), the headless rotation engine in `src/auth/browser-refresher.ts`, and the deleted legacy files list (`auth-service`, `cookie-monitor`, `cookie-storage-service`, `profile-auth-manager`). Also record the deletion hazard itself: unrelated docs commits must not drop sensitive-area doctrine (this regression's cause).

### D4: Flip the auth-regression CI gate; annotate archived ledgers

Complete fix-4 task 3.4: change the workflow's auth-gate step from warn-only to blocking (`SKIP_AUTH_REGRESSION_GATE=1` remains the audited escape hatch). Verify in CI (fix-4 6.2): confirm the gate and canary steps run green on the PR that carries this change. Annotate archived tasks honestly (the fix-1 7.4 precedent): fix-4 `tasks.md` 6.3 gets a closure note explaining the archive-before-validate self-contradiction (validation was performed post-archive; this annotation records it); fix-3 `tasks.md` 3.2 is checked only when this change's live idle verification passes, with a pointer here.

### D5: `chat-list-bulk-actions` - re-baseline or close, decided by inspection

The change (open since 2026-06-12, zero tasks done) references the deleted mediator and `ProfileAuthManager.getActiveProfiles()` at baseline 861. Decision rule: if its capability is still wanted, re-baseline its design/tasks to the current architecture (CookieSession context, CommandRegistry dispatch, current baselines) as part of this change's housekeeping commit; if not, close it with a supersession note. Default: re-baseline (the user has not withdrawn the capability; only the machinery moved). This change does not implement it.

### D6: Storage freshness recast as display metadata

The 7-day local rule stays mechanically identical (it populates ACTIVE/EXPIRES and gates `loadCookiesForApi`) but its requirement text now states it is local, display-only metadata with no server-side validity meaning (ablation-proven), and names `CookieSession.probe` as the only validity oracle, with a scenario pinning that no recovery/re-auth decision may key off `isActive` alone. This closes the audit's "last place local-expiry influences an 'active' verdict" note without touching runtime code.

## Risks / Trade-offs

- **Spec literals drift during implementation** - mitigated by D2's verify-before-archive task; the byte-equivalence suites remain the hard gate for behavior.
- **CI gate flip could block on pre-existing warnings** - mitigated by running the gate and canary on this change's own PR first (D4); the env escape hatch remains for audited emergencies.
- **Keepalive RED test could pass vacuously** - mitigated by D1's requirement that the fake refresher mutate the fake store, plus the live idle verification gate (fix-3 3.2 finally closes).

## Migration Plan

No runtime migrations. Spec deltas apply at archive; AGENTS.md and workflow edits land with the implementation commits; archived-ledger annotations are appended in place (history-preserving).
