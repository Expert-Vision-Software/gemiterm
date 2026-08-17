# Re-implementation guide — changes through v2.7.2

**Range:** every commit in `b36e6276..58c9aa9` (152 commits), oldest first.
**Excluded:** all authentication, cookie, probe, and phantom-session work — i.e. anything covered by `docs/archive/phantom-bug-synthesis.md` (L1 `RotateCookies`, L2 silent refresh, `CookieMonitor` jar capture, `ensureAuthenticated` gates, `session-state`/`sessionInvalid`, the status PROBE column, `auth-daemon`, and every `spec:/archive/` bookkeeping commit tied to those changes).
**Surviving scope:** the Gemini chat client, list/status/continue CLI commands, build/release tooling, test harness, and the OpenSpec/skills scaffolding that is independent of the auth saga.

Each item below is the 2-line prompt to recreate that commit. Apply them in order.

---

## v2.5.0 → v2.6.0 prep (add-docs-and-specs)

**`c0051e9` pre-bump version**
Bump the version field in `package.json` ahead of the docs-and-specs release.
No code change — version string only.

**`cc38570` Merge branch 'add-docs-and-specs'**
Integrate the docs-and-specs branch (no source merge conflicts).
Merge commit only.

## api-resilience-error-handling branch (chat client + list handler fidelity)

**`271335a` fix: listChats throws on null SDK return; profileHasConversation propagates errors**
`GeminiClientService.listChats` must throw `GemitermError("Gemini returned no data — session may be expired")` when the SDK returns `null`/`undefined`, instead of silently coercing to `[]`.
`GeminiClientService.profileHasConversation` stops swallowing exceptions — remove the `try/catch` that returned `false`; call `listChats({ limit: 50 })` and `.some(chat => chat.id === conversationId)`.

**`05da155` feat: filter unauthenticated profiles, use Promise.allSettled in ListChatsQueryHandler**
`ListChatsQueryHandler` --all-profiles path iterates every profile via `Promise.allSettled`, filters out unauthenticated profiles (warn + skip), aggregates `[value]`'s chats per profile, and records `reason` messages for rejected profiles.
Return an empty `{ chats: [] }` result when no profiles are authenticated.

**`d3deee3` fix: wire ProfileManager and Logger into ListChatsQueryHandler**
`ListChatsQueryHandler` constructor takes `(getGeminiClient, profileManager, logger)` instead of the old `(getGeminiClient, listProfiles)` tuple.
Update the handler registration in `cli/index.ts setupMediator` accordingly.

**`798ed02` fix: code review — capture profile name in allSettled loop; limit:1 for profileHasConversation**
The `Promise.allSettled` map must capture the per-index `name` in a local `const` so the closure sees the right value (not the loop variable).
`profileHasConversation` passes `limit: 1` (existence check) and lets `listChats` errors propagate; `gemini-client-wrapper` keeps the error surface.

**`2881f00` chore: mark all tasks complete, record final test baseline (835 tests)**
Update OpenSpec task status and record the post-implementation test count (835) in docs.
Bookkeeping only.

**`b1d51f5` chore: sync delta specs to main specs, archive api-resilience-error-handling**
Sync the api-resilience delta specs into main specs and move the change to `openspec/changes/archive/`.
OpenSpec bookkeeping.

**`4fa5c14` update testing baseline**
Refresh `docs/testing-baseline.xml` to the new pass/expect counts.
Bookkeeping.

**`20e5f8d` Merge branch 'api-resilience-error-handling'**
Integrate the branch into main.
Merge commit only.

**`d9e30f5` changelog**
Update `CHANGELOG.md` with the api-resilience / session-management entries for this release.
Docs only.

## v2.5.0 release + build overhaul

**`1778e02` feat(build): update build scripts and paths for Linux and Windows binaries; remove deprecated lint scripts**
Rework `scripts/build.ts` target-naming/paths for `bun-linux-x64` and `bun-windows-x64` outputs; align `package.json` build scripts and `.github/workflows/release.yml`.
Remove the deprecated path-mediation lint scripts (`lint-path-mediation.ps1`/`.sh`) and update `docs/testing-protocol.md` + `docs/testing-baseline.xml`. **Note:** the path-mediation lint was re-introduced later, so a faithful reimplementation should keep both versions available.

**`64047b9` update and install skills**
Add repo-local `.agents/skills/` files (diagnosing-bugs hitl-loop template, grilling skill).
Skills scaffolding.

**`278bb58` clean up tests and docs a bit**
Delete the obsolete parity harness (`tests/parity/compare-outputs.ts`, `test-commands-parity.{ps1,sh}`), `openspec/MAESTRO_MIGRATION.md`, `examples/sample_markdown_export.md`, and the parity dep in `package.json`.
Pure deletion (~900 lines removed).

**`5a8cfde` skills**
Install additional repo-local `.agents/skills/` content (grill-with-docs skill + agents/openai.yaml).
Skills scaffolding.

**`61174ad` skill test-baselining**
Add/update skill test-baselining config.
Skills scaffolding.

**`14e37a6` sync and archive**
Sync and archive OpenSpec change bookkeeping (no source code).
OpenSpec bookkeeping.

**`b65a2d0` missed skill files**
Add the skill files missed in the earlier skills commits.
Skills scaffolding.

## v2.6.0 list-command interactive fix

**`807a7ea` fix(list-command): forward chat.profile to sub-commands in interactive action dispatch**
In `list-command.ts` interactive (`--interactive`/`-i`) mode, when the user picks a chat and an action (export / continue / delete), forward that chat's `profile` to the dispatched sub-command payload.
Without this, multi-profile actions run against the default profile instead of the chat's owning profile.

## v2.6.1 / v2.6.2 continue + status + cli changes

**`6a7fdfd` docs(openspec): propose profile-aware-factory-wiring change**
File the proposal/design/tasks for `profile-aware-factory-wiring` (make `getGeminiClient(profileName)` actually route to the named profile).
OpenSpec proposal only.

**`01794ae` fix(profile-resolution): suggest 'gemiterm login' instead of '--renew <name>'**
The `AuthenticationError` thrown when an explicit profile has no valid session should hint `'gemiterm login'` (generic), not `'gemiterm auth --renew <name>'`.
One-line change in `src/cli/utils/profile-resolution.ts`.

**`2d9fc76` fix(continue): drop interactive printLastMessage pre-fetch to share dispatch with non-interactive path**
Remove the interactive-only `printLastMessage` pre-fetch from `continue-command.ts` so interactive and non-interactive continue share one dispatch path.
Deletes `printLastMessage`, the `FETCH_CHAT` import, and its test.

**`92c47ad` docs(openspec): propose interactive-non-interactive-divergence change**
File the proposal describing that interactive paths must route through the mediator.
OpenSpec proposal only.

**`f3fdf38` fix(continue): skip --profile and --prompt-file flag values when parsing positional args**
Convert the positional-arg loop to index-based; when the current arg is `--profile`/`-p` or `--prompt-file`/`-f`, increment `i` to skip its **value** before continuing.
Ensures `gemiterm continue <conv> --profile <name> <msg>` parses `<msg>` as the message, not the profile value.

**`742521e` fix(continue): preserve chatMetadata ctx in fetchChat; restore printLastMessage**
`GeminiClientService.fetchChat` looks up existing `chatMetadata` first and writes `ctx: existing?.ctx ?? null` (preserves the context token) instead of clobbering `ctx` to `null`.
`continue-command.ts` re-adds `printLastMessage` (prints "Last response:" + last model turn) before the REPL loop.

**`1a794b3` feat(status): add --verbose flag for cookie ages and storage paths**
Add `gemiterm status --verbose/-v`: prints a **Cookies** section (per-profile count + `__Secure-1PSIDTS` expiry countdown) and a **Storage** section (per-profile `getProfileDir` path).
Add `formatDuration(ms)` ("Xh Ym" / "Xd Yh" / "expired"/"unknown") to `infrastructure/formatters.ts`; refactor usage text into `showUsage()`.

**`5ba90d4` revert(continue): drop printLastMessage from interactive REPL for v2.6.2**
Revert the `printLastMessage` re-addition from `742521e` for the v2.6.2 release (the ctx-preservation half of 742521e stays).
Removes the `printLastMessage` method + its dedicated test.

**`7ab16c6` docs(changelog): document 2.6.2 added/fixed/internal items**
Add the v2.6.2 added/fixed/internal sections to `CHANGELOG.md`.
Docs only.

## chat metadata seeding

**`809240a` fix(chat): seed rid/rcid metadata from existing conversation on send**
`GeminiClientService.sendMessage`, when there is **no** stored `chatMetadata` for the conversation: call `readChat(conversationId)`, find the last model turn, and if it has a `rid`, persist `{ rid, rcid: rcid ?? "", ctx: existing?.ctx ?? null }` for the profile (a new `seedMetadataFromChat` helper).
On a successful seed, rebuild the session with the seeded rid/rcid; on `readChat` failure or no model turn, fall back to the existing cid-only send.

## post-saga cleanup, phase-0 framework, and v2.7.0

**`f497bcc` chore: remove repo-local skills, archive cookie-jar-integrity, clean up openspec**
Remove the repo-local `.agents/skills/grill-with-docs` tree (no longer needed); archival of the cookie-jar-integrity OpenSpec change is bookkeeping.
General skills cleanup.

**`85739a0` / `f60ae20` docs(phase-0): establish regression-net framework + agent skills**
Create `docs/agents/` (domain convention, issue-tracker, triage-labels) and `docs/phase-0/plan.md` describing the regression-net framework.
The two commits establish/amend the same agent-skills + phase-0 planning docs.

**`0fea620` fix(phase-0-v2): wire profile arg in ListChatsQueryHandler factory**
The `getGeminiClient` factory passed to `ListChatsQueryHandler` must forward its `profileName` argument (the lambda had dropped it in earlier wiring at `cli/index.ts`).
Also correct the `0f` test assertions to match the current `RotateCookiesResult` shape.

**`1ed196a` docs(phase-0): update v2 design plan**
Mark completed phases/tests and remaining steps in `docs/phase-0/phase-0-v2-design.md`.
Docs only.

**`a32169f` chore: bump version to 2.7.0 — major refactoring**
Bump `package.json` to `2.7.0`.
Version only.

**`b5dc3de` fix(phase-0-v2): fix profile-routing lambda drops profileName argument**
The factory lambda in `cli/index.ts` was constructed once and dropped the per-call `profileName` arg; pass it through so each query targets the right profile.
Regression fix for profile routing.

**`0621f41` docs(v2.7.0): update CHANGELOG with Phase 0 + v2.7 fixes; finalize bug ledger entries**
Add v2.7.0 CHANGELOG content and finalize the bug-ledger entries.
Docs only.

**`4e6d0db` fix(smoke): increase status smoke test timeout to 15s for PROBE column network calls**
Set `{ timeout: 15_000 }` on the "status runs without crashing" smoke test in `tests/smoke/smoke.test.ts`.
Test-infra only.

**`f128bf5` add doc**
Add `docs/alternate-plan-simplify.md` (alternate simplification plan notes).
Docs only.

**`dada68a` feat(conversation-threading): add ConversationThreading module**
Add `src/services/conversation-threading.ts` with `makeMetadata / extractMetadata / threadOnto / captureFrom` to own the `[cid, rid, rcid, …, ctx]` metadata-array protocol.
Wire `GeminiClientService` to use the module for building/reading session metadata; add `tests/services/conversation-threading.test.ts`.

**`a2a12e3` chore(review): remove unused ReauthRequired, rename test helper makeCookie**
Delete the now-unused `ReauthRequired` export and rename the `makeCookie` test helper for clarity in the threading/session-state tests.
General cleanup.

**`88eecc5` docs(openspec): update profile-aware-factory-wiring baseline and line refs**
Refresh the profile-aware-factory-wiring change's baseline numbers and source line references.
OpenSpec bookkeeping.

**`1c247cf` docs(openspec): update chat-list-bulk-actions baseline to 990/991**
Refresh the chat-list-bulk-actions change's baseline numbers.
OpenSpec bookkeeping.

**`2ceb28f` docs(changelog): update v2.7.0 with dormancy resilience + A/C/B/E architecture refactors**
Expand the v2.7.0 CHANGELOG section.
Docs only.

## v2.7.1 — test-harness hardening

**`6606ef9` fix(smoke): use temp dir for GEMITERM_CONFIG_DIR instead of empty string**
The smoke harness must spin up a fresh temp config dir per run: `mkdtempSync(resolve(tmpdir(), "gemiterm-smoke-"))` assigned to `GEMITERM_CONFIG_DIR`, with `afterAll` `rmSync` cleanup.
Replaces the previous `GEMITERM_CONFIG_DIR: ""` env (which polluted the real config dir).

**`1edfd9d` chore: code-review fixes — dedup smoke setup, drop dead activePsid snapshot, guard CI config leak**
Dedupe the smoke config-dir setup into a `beforeEach`; drop the dead `activePsid` snapshot from `gemini-client-wrapper` tests; tighten a CI config-leak guard.
General test/code hygiene.

**`b6b65b0` chore: bump to v2.7.1**
Bump `package.json` to `2.7.1`.
Version only.

**`3cf6a8d` docs: expand v2.7.1 changelog — dormancy fix, test leak fixes, dead code removal**
Add v2.7.1 CHANGELOG content (the dormancy-fix lines reference excluded auth work; reimplementation only needs the "test leak fixes / dead code removal" portions).
Docs only.

---

## Excluded commits (auth / cookie / phantom-probe work)

Omitted in full per the scope rule — every commit touching `auth-service`, `cookie-*` (monitor/storage/rotation/jar), `profile-auth-manager` ensure/RotateCookies/silentRefresh paths, `session-state`, the status PROBE column, `auth-daemon`, and all their `openspec/changes/*` proposal/spec-sync/archive bookkeeping. These are documented in `docs/archive/phantom-bug-synthesis.md` and are intentionally out of scope for this guide.
