## 1. Regression harness (red first)

- [ ] 1.1 `tests/auth-regression/` or routing unit test: explicit `-p <stale>` — `resolveProfile` with classifier=phantom for the explicit profile MUST arm + await (fake rotation landing on disk) + proceed; watch it fail (today: instant AuthenticationError, nothing armed).
- [ ] 1.2 `listChatsOutcomes` mixed-liveness test: live profile returns chats, stale profile returns 0 with rotation in flight → list MUST await + re-query the stale profile only; watch it fail (today: no wait, merged result non-empty path skips the await stage entirely).
- [ ] 1.2b Control (field-green 2026-08-18 12:43, commit 3208d89, gemiterm2 checkout): aggregate `list` where ALL configured profiles arm stale and all rotations land → wait fires, all profiles re-queried, merged result renders. This works today via the merged-empty trigger; MUST keep working after the trigger moves to per-profile outcomes.
- [ ] 1.3 `findProfileForConversation` stale-owner test: live pass misses, stale-armed profile's rotation lands and owns the conversation → returns that profile; watch it fail (today: null).
- [ ] 1.4 Default-client revalidation test (gap 4, field repro 2026-08-18 12:37): `getGeminiClient` cached instance built on stale PSIDTS; jar rotates on disk (simulated `ensureSession` re-arm); retry path MUST construct a fresh client on the changed PSIDTS and the retried read MUST succeed in the SAME process; watch it fail (today: cached client returned, retry phantom-fails empty).

## 2. Implementation

- [ ] 2.1 `src/cli/utils/profile-resolution.ts`: explicit-profile path → configured check → `ensureSession(profile)` → if `rotationInFlight`, stderr notice + `waitForRotation` → reclassify; return `{ profile, state }`-shaped result (or equivalent) so commands can branch on live vs stale-without-recovery.
- [ ] 2.2 `fetch-command.ts` / `continue-command.ts`: on non-live after wait — interactive recovery confirm (prompts facade, mirror list-command.ts:169-186 patterns incl. `NonInteractiveError`/`CancellationError` handling); non-interactive typed `AuthenticationError` naming profile + state + remediation. No default-profile fallback on the explicit path.
- [ ] 2.3 `src/cli/utils/gemini-queries.ts`: add `listChatsOutcomes` (per-profile `{ profile, chats | error }`); `listChatsForRequest` becomes a thin merge over it (signature/behavior unchanged for existing callers).
- [ ] 2.4 `list-command.ts`: replace the merged-empty trigger in `resolvePhantomEmptyResult` with the per-profile outcomes check (await + re-query only empty-or-failed profiles whose rotation is in flight); keep the existing still-in-flight hint and downstream probe/recovery ladder unchanged; all notices stderr-only.
- [ ] 2.5 `src/auth/cookie-session.ts` `findProfileForConversation`: two-pass (live pass unchanged; pass 2 = armed-stale profiles whose `waitForRotation` landed), live-priority preserved; no spawns/writes in pass 2.
- [ ] 2.6 Confirm `export`/`export-all`/`delete` inherit the arm-and-await via `resolveProfile` without new prompts (open question in design — no recovery confirm on destructive paths by default).
- [ ] 2.7 `src/cli/index.ts` `getGeminiClient`: cache revalidation — re-arm via `profileCookieLoader` on each call, remember the `secure_1psidts` the cached instance was built with, reconstruct the `GeminiClientService` when it changed; unchanged jar returns the cached instance (zero added latency; one SDK init GET only per rotation landing).

## 3. Gates + docs

- [ ] 3.1 `tests/integration/commands/list.test.ts`: mixed-liveness scenarios added; all-fresh scenarios byte-pinned unchanged.
- [ ] 3.2 Run `bun test --isolate`, `bun run typecheck`, `bun run lint:mediation`, `bun run check:auth-gate` (touches `src/auth/cookie-session.ts` — auth-sensitive — plus `tests/auth-regression/`).
- [ ] 3.3 Append the `docs/auth-cookie-lifecycle.md` changelog entry (stale-profile reachability; cross-reference the 2026-08-18 DHBGAMING2 field repro).
- [ ] 3.4 Rebase check before archive: reconcile this change's `commands` delta against `fix-5-audit-remediations` and `chat-list-bulk-actions` final text; archive order those two first.
