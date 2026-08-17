# Tasks: fix-5-audit-remediations

Baseline: `bun test --isolate` -> 937 pass / 2 skip / 0 fail / 2007 expects / 66 files (audited 2026-08-17). Run `bun run typecheck` after each group; `bun run lint:mediation` (bash form) after groups touching scripts/workflows; conventional commits per group; never push.

## 1. Keepalive fast-path fix (audit finding 1)

- [ ] 1.1 RED test in the session-keepalive test file: a fake refresher whose `rotatePsidts` PERSISTS a new PSIDTS value into the fake cookie store and resolves `{ rotated: true, cookies: <rotated jar> }`; assert the next tick (within the interval, unchanged disk) skips the refresher entirely - this test MUST fail on current code
- [ ] 1.2 Fix `src/auth/session-keepalive.ts` `tick()`: on `result.rotated`, set `lastObservedBaseline` from the rotated jar (`findRoutableCookieValue(result.cookies, PSIDTS_COOKIE_NAME)`), falling back to a post-rotation store re-read when the result carries no cookies; GREEN the RED test; confirm the existing keepalive tests still pass
- [ ] 1.3 Live verification (user-assisted; closes archived fix-3 task 3.2): open the REPL, idle > 30 min, then chat - session still live; verbose log shows the first due rotation spawning the browser and subsequent ticks skipping while PSIDTS is unchanged; annotate archived `openspec/changes/archive/2026-08-16-fix-3-session-keepalive/tasks.md` 3.2 with the closure pointer to this change

## 2. Spec sync verification (audit finding 3 - deltas land at archive)

- [ ] 2.1 Verify every pinned literal in this change's `specs/commands/spec.md` delta against current code before archive: `Error: conversation ID is required.`, `Cancelled.`, `Conversation '<id>' deleted.`, `Continuing with current default profile.`, `Profile '<name>' does not exist.`, the auth menu option letters, and the `--add/--delete/--rename/--default/--renew` flag surface in `auth-command.ts` usage; correct the delta (not the code) on any mismatch
- [ ] 2.2 Confirm no main spec outside this change's five deltas still references `AuthService`, `CookieMonitor`, `CookieStorageService`, `ProfileAuthManager`, `profileAuthManager`, or `ProfileCommand` as a live surface (grep `openspec/specs/`); any residual hit gets a delta here before archive

## 3. AGENTS.md sensitive-area restore (audit finding 2)

- [ ] 3.1 Reinstate the sensitive-area section in `AGENTS.md` (recover from commit `ea78f37`, verify against current surface): `playwright-cli-driver.ts` regression gates (`openHeaded`, `openHeadless` persistent-profile argv without `--headed`, `stateSave` wrapping `state-save`), the headless rotation engine in `src/auth/browser-refresher.ts`, and the deleted legacy files list (`src/services/{auth-service,cookie-monitor,cookie-storage-service,profile-auth-manager}.ts`)
- [ ] 3.2 Add a one-line hazard note in the same section: sensitive-area doctrine must not be dropped by unrelated docs commits (regression introduced by `67bc148`, caught by the 2026-08-17 audit)

## 4. CI gate flip + archived-ledger annotations (audit finding 4)

- [ ] 4.1 Flip the auth-regression gate in the CI workflow from warn-only to blocking (completes archived fix-4 task 3.4); keep `SKIP_AUTH_REGRESSION_GATE=1` as the audited escape hatch
- [ ] 4.2 Verify on this change's own CI run (completes archived fix-4 task 6.2): auth-gate (blocking) and the mutation canary both green
- [ ] 4.3 Annotate archived `openspec/changes/archive/2026-08-16-fix-4-auth-regression-guards/tasks.md`: 6.3 closure note (validation executed post-archive; this annotation records the self-contradiction), and mark 3.4/6.2 as completed-by-fix-5 with pointers

## 5. chat-list-bulk-actions re-baseline (audit finding 4, second half)

- [ ] 5.1 Re-baseline `openspec/changes/chat-list-bulk-actions/` artifacts to the current architecture: replace mediator/`ProfileAuthManager.getActiveProfiles()` references with the CookieSession context and current dispatch, refresh the test baseline (937/2/0/2007/66), and re-scope tasks to the current chat-list surface - OR, if inspection shows the capability is withdrawn, close it with a supersession note; record the decision and rationale in its proposal

## 6. Verification gates

- [ ] 6.1 `bun test --isolate` green with the new baseline recorded here (expect +1 net from task 1.1; 937 -> 938); `bun run typecheck` clean; `bun run lint:mediation` clean
- [ ] 6.2 `tests/integration/commands/list.test.ts` byte-equivalence green; no CLI output changes from this change's code edits (keepalive only)
- [ ] 6.3 `openspec validate --all --strict` green; archive this change with spec sync per the repo workflow
