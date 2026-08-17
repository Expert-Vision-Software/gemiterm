# Design: fix-3b-auth-regressions

## Context

fix-3 landed `SessionKeepalive` with the floor implemented as private state inside `tick()`, so a manual `CookieSession.refresh()` (the custom `refresh` command) bypasses it entirely — the fix-3 delta scenario "manual refresh 30 s after scheduled rotation is suppressed" cannot pass. The REPL wiring guards keepalive construction on `profileName !== null` in `continue`, and `new` uses the literal `?? "default"` fallback which can mismatch the real default profile directory. The code review also flagged the `text`/`CancellationError` re-export in `interactive-prompt.ts` (consumers should consume the facade, not re-publish it) and dead/pass-through surface (`getLastRotationTime()`, the `cookieStore`/`refresher` getters).

## Goals / Non-Goals

**Goals:**

- The 60-second rotation floor is enforced once per process for the active profile, shared by the keepalive loop and manual `refresh()`, in both directions.
- Every REPL session gets exactly one keepalive, constructed with the correctly-resolved effective profile.
- The prompt facade's symbols are imported only from `prompts.ts`; no consumer re-exports them.
- `CookieSession` exposes one deep factory (`createKeepalive`) instead of collaborator getters; unused getter deleted.

**Non-Goals:**

- Cross-process coordination with the detached refresh-runner (the store's lock + CAS already serialize that boundary; only the in-process floor is in scope).
- Any change to rotation mechanics, jar persistence, validation, phantom recovery, or one-shot command behavior.
- Waiting/queuing semantics for a suppressed manual refresh (it returns immediately, per spec).

## Decisions

### D1: Shared floor via an injected per-profile cooldown, owned by `createCookieSession`

A small `RotationCooldown` (a `profile -> lastSuccessfulRotationTime` map with `canRotate(profile, now, floorMs)` / `record(profile, now)`) is constructed once in `createCookieSession` and injected into both `CookieSessionDeps` and — through the keepalive factory — `SessionKeepaliveDeps`. `CookieSession.refresh()` and `SessionKeepalive.tick()` both consult it before calling `rotatePsidts` and record on `rotated: true`. A suppressed manual `refresh()` resolves `{ rotated: false }` with a debug log (consistent with fix-3 D4's silent-diagnostics stance; the manual command already renders `rotated: false`). Alternatives: a module-level singleton in `session-keepalive.ts` (hidden global — rejected: untestable coupling and invisible to the facade's DI seam); enforcing the floor inside `BrowserRefresher.rotatePsidts` itself (rejected: the refresher is fix-1's engine and this change must not touch rotation mechanics).

### D2: Effective-profile resolution at the commands, factory construction at the facade

`continue` computes `profileName ?? await getDefaultProfileName()`; `new` replaces the literal `?? "default"` with the same call (the literal can point at a nonexistent profile directory, silently rotating nothing). Both then call `context.cookieSession.createKeepalive(effectiveProfile)` — keepalive construction becomes unconditional for interactive sessions (`message === null`), regardless of profile-resolution outcome. The `RotationResult`-returning manual command path is untouched apart from floor enforcement inside `refresh()`.

### D3: `createKeepalive(profile)` factory replaces the collaborator getters

`CookieSession.createKeepalive(profile, options?)` wires `cookieStore`, `refresher`, the shared cooldown, and a `session-keepalive`-scoped logger into a `SessionKeepalive` and returns it (it satisfies `SessionKeepaliveHandle` structurally, so `interactive-prompt.ts` needs no import from `src/auth/`). The `cookieStore`/`refresher` getters are deleted — they let CLI files assemble collaborator slices themselves, which the facade requirement ("no file outside `src/auth/` may import the collaborators directly") already discouraged. `SessionKeepalive.getLastRotationTime()` is deleted with them.

### D4: Re-export removal, facade imports restored

`interactive-prompt.ts` drops `export { CancellationError, text }`; `chat-session.ts` imports both from `./prompts.ts` and continues passing them as DI tokens to `runInteractiveLoop`. A grep gate (no file imports `CancellationError`/`text` from `interactive-prompt`) plus the prompt-layer delta scenario pin the rule.

## Risks / Trade-offs

- [Manual refresh silently no-ops inside the floor window] → Mitigation: debug log on suppression; the manual command's existing `rotated: false` messaging covers the UX; window is only 60 s.
- [Delta specs modify requirements fix-3 added, but fix-3 is not yet archived] → Mitigation: this change declares the ordering dependency; archive fix-3 (after its user-assisted 3.2 live check) before syncing fix-3b deltas.
- [`getDefaultProfileName()` adds a config read on REPL entry] → Mitigation: single cheap file read at loop start; cached nowhere else, same cost class as `ensureSession`'s.

## Migration Plan

Additive factory + floor seam + deletion of dead surface; no storage-format or CLI-contract migration. Land after fix-3 archive; rollback is a plain revert.
