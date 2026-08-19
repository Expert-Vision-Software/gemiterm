# Proposal: fix-5-audit-remediations

Sequence: fix-5 (follows the archived fix-1..fix-4 arc). Source: the 2026-08-17 post-landing audit of the auth replacement — 21 PASS / 2 PARTIAL / 0 FAIL on the directive checklist, plus spec/process drift findings. This change remediates the five audit findings; it does not alter the auth architecture.

## Why

The CookieSession replacement landed and holds its directives (no cookie-name filtering, browser-backed rotation, CAS store, honest classification). The audit found five residual defects: (1) the session-keepalive no-op fast path is dead code — after a successful rotation the loop records the *pre*-rotation PSIDTS as its baseline (`session-keepalive.ts` `tick()`), so every 10-minute tick spawns a browser forever after the first rotation, contradicting the `auth` spec's skip scenario and burning the rotation budget; (2) the AGENTS.md playwright-cli sensitive-area section (added by fix-1 task 6.5, commit `ea78f37`) was deleted by an unrelated docs commit (`67bc148`) — the regression-gated driver surface is undocumented; (3) five main specs still describe the deleted legacy architecture (`AuthService`, `CookieMonitor`, `ProfileAuthManager`, a mediator, a `ProfileCommand` that was never registered, a pre-async `listProfiles` signature) and now contradict both the code and AGENTS.md; (4) process drift — fix-4 was archived with tasks 3.4 (CI gate flip to blocking) and 6.2 (CI verification) unchecked and 6.3 self-contradictory, and the long-open `chat-list-bulk-actions` change still targets the deleted mediator architecture at a stale baseline; (5) the `storage` spec presents the 7-day local-expiry rule as *the* validity rule, but the ablation proved local expiry is meaningless for validity — it must be scoped as display metadata with `CookieSession.probe` named as the oracle.

## What Changes

- **Keepalive fast-path fix**: after a successful rotation, set the loop's `lastObservedBaseline` from the rotated jar (`result.cookies`), not the pre-rotation disk value; add the missing RED test (fake refresher that actually mutates the store) and the user-assisted live idle verification that fix-3 left unchecked.
- **AGENTS.md restore**: reinstate the sensitive-area section covering `PlaywrightCliDriver` `openHeadless`/`stateSave`, the headless persistent-profile rotation in `browser-refresher.ts`, and the deleted-legacy-files list.
- **Spec truth-sync**: deltas on `commands` (ContinueCommand, DeleteCommand, AuthCommand, CommandRegistry MODIFIED to the CookieSession/no-mediator reality, `login` alias, async `listProfiles`; ProfileCommand REMOVED as never-implemented), `profile-lifecycle` (login delegation to `CookieSession.captureLogin`, updated construction bans), `multi-profile-conversations` (facade-based profile resolution), `no-capability-changes` (one stale scenario clause), and `storage` (Freshness/getStatus recast as display-only metadata with the probe as the validity oracle).
- **Process housekeeping**: flip the auth-regression CI gate from warn-only to blocking (completing fix-4 task 3.4) and verify it in CI (6.2); annotate the archived fix-4 tasks (6.3 closure note) and the archived fix-3 task 3.2 closure; re-baseline or close the stale `chat-list-bulk-actions` change.
- No auth-behavior changes: capture, rotation, storage, validation, classification, and recovery surfaces are untouched.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `commands`: ContinueCommand, DeleteCommand, AuthCommand, and CommandRegistry requirements re-specced to the shipped architecture (CookieSession context, direct dispatch, `login` alias, async `listProfiles`); ProfileCommand requirement removed (never implemented).
- `profile-lifecycle`: the module delegates the login flow to `CookieSession.captureLogin` and its construction/injection bans reference the current collaborator set.
- `multi-profile-conversations`: continue/delete profile resolution routes through the CookieSession facade via the shared `resolveProfile` helper.
- `no-capability-changes`: one scenario clause updated off deleted surfaces.
- `storage`: `Freshness and Validity` and `ProfileManager.getStatus` scoped as local, display-only metadata; the session-validity oracle is the auth capability's `CookieSession.probe`.

## Impact

- **Code**: `src/auth/session-keepalive.ts` (one-line baseline fix), its test file (new RED case), `.github/workflows/` (gate flip), `AGENTS.md` (restored section), archived `openspec/changes/archive/2026-08-16-fix-4-*` and `fix-3-*` tasks.md (honest inline closure notes, per the fix-1 7.4 precedent), `openspec/changes/chat-list-bulk-actions/*` (re-baseline or supersession note).
- **Not changed**: any auth runtime behavior except the keepalive tick's skip eligibility; CLI output bytes; on-disk formats.
- **Tests**: baseline 937 pass / 2 skip / 0 fail / 2007 expects / 66 files (audited 2026-08-17); expect +1..2 net from the keepalive RED case. Gates: `bun run typecheck`, `bun run lint:mediation` (bash form), `bun test --isolate`, `tests/integration/commands/list.test.ts` byte-equivalence, `openspec validate --all --strict`.
- **Dependencies**: none.
