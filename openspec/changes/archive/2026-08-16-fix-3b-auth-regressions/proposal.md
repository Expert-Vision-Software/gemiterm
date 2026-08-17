# Proposal: fix-3b-auth-regressions

Sequence: follow-up to fix-3 `session-keepalive` (hard dependency: fix-3 must be archived before this change's delta specs can sync, because two of the deltas modify requirements fix-3 added). Independent of fix-2 and fix-4.

## Why

The fix-3 code review surfaced 4 findings: two spec gaps (the 60-second rotation floor is not actually shared with manual `refresh()`; the REPL keepalive is skipped when profile resolution returns `null`) and two standards findings (the prompt facade's symbols are re-exported through `interactive-prompt.ts`, bending the single-facade rule; `CookieSession` grew pass-through getters and `SessionKeepalive` an unused getter). The spec gaps mean the fix-3 delta scenarios cannot pass as written — the floor scenario is unimplementable in the current shape and the lifecycle scenario has a hole in `continue`.

## What Changes

- The 60-second rotation floor becomes genuinely shared in-process: a manual `CookieSession.refresh()` invoked shortly after a keepalive rotation is suppressed by the same floor (and vice versa), matching the fix-3 auth delta scenario "The 60-second floor prevents double rotation".
- The REPL keepalive starts unconditionally on REPL entry: `continue` and `new` resolve the effective profile (defaulting via `getDefaultProfileName()` when resolution returns `null`) so the keepalive is always constructed for interactive sessions.
- The prompt-facade re-export is removed: `chat-session.ts` imports `text`/`CancellationError` from `prompts.ts` directly; `interactive-prompt.ts` no longer re-exports facade symbols (consumers consume the facade, they do not re-publish it).
- Dead surface is deleted: `SessionKeepalive.getLastRotationTime()` is removed; the `CookieSession.cookieStore`/`refresher` pass-through getters are replaced by a single `createKeepalive(profile)` factory method on the facade that constructs the keepalive with correctly-wired deps (commands stop assembling deps themselves).

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `auth`: the session-keepalive requirement's floor clause is strengthened — the 60-second floor MUST be enforced at a seam shared by the keepalive loop and manual `refresh()` within one process; the facade gains the keepalive factory as sanctioned surface (replacing the collaborator getters).
- `interactive-prompt-loop`: the keepalive-lifecycle requirement's entry clause is strengthened — the keepalive loop MUST start for every REPL session regardless of whether profile resolution produced an explicit name.
- `prompt-layer`: adds a requirement that facade symbols (`text`, `confirm`, `select`, `CancellationError`) are imported from `prompts.ts` by consumers and MUST NOT be re-exported by consumer modules.

## Impact

- **Code**: `src/auth/session-keepalive.ts` (floor hoisted to shared seam, getter deleted), `src/auth/cookie-session.ts` (floor enforcement in `refresh()`, `createKeepalive` factory replacing getters), `src/cli/commands/continue-command.ts` + `new-command.ts` (unconditional keepalive construction via the factory, effective-profile resolution), `src/cli/utils/interactive-prompt.ts` (re-export removed), `src/cli/utils/chat-session.ts` (imports from the facade directly).
- **Not changed**: rotation mechanics, CAS persistence, validation, phantom detection, one-shot command paths, the REPL prompt/slash-command contract.
- **Tests**: shared-floor suppression tests (manual-after-scheduled and scheduled-after-manual), unconditional-start lifecycle tests, factory wiring tests, prompt-layer re-export contract test. Baseline: 905 pass / 2 skip / 0 fail (post-fix-3).
- **Dependencies**: none new; hard ordering dependency on fix-3 archive for spec sync only.
