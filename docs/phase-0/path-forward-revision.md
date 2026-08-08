# Path-Forward Revision — Reconciling the WSL Investigation with the Architecture Review

**Date:** 2026-08-08
**From:** session that investigated the WSL/Windows-native hypothesis and Phase 0 PR #19
**Reading:** `C:/Users/diego/AppData/Local/Temp/architecture-review-auth-2026-08-07.html` (the original plan) + `docs/phase-0/investigation-report.md` (this session's findings)
**Status:** Misalignments identified; corrected path forward proposed

---

## TL;DR

The original plan's central premise was **Phase 0 lands RED on prod v2.6.1 as the regression-net gate that `fix/v2.6.1-bugs` cannot close until Phase 0 goes GREEN**. PR #19 (the Phase 0 implementation) does **not** satisfy this premise — the 19 tests are GREEN on every branch because the cookie-aware fake in `tests/helpers/full-stack-fixture.ts` exercises the *symptom* (full jar → `listChats` works) without exercising the *cause* (`cookie-monitor.ts:179` filters the jar before persisting). The "merge-while-RED" strategy is non-functional.

The *correct* regression net already exists at a different seam: `tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`). It pins the full-jar contract at `CookieMonitor.poll`'s callback payload. Goes RED on `main@v2.6.1`, GREEN after `6bc51f6`. **That's the gate the original plan was trying to build; Phase 0 simply put it in the wrong place.**

**Recommendation:** close PR #19; merge `fix/v2.6.1-bugs` → `main` (the regex net at the right seam is already on that branch); tag v2.6.2; user re-auths on Windows-native; branch `overhaul/cookie-jar-unification` off `main@v2.6.2` for Candidates A, then B, then C, then D. Candidates A-E remain valid; the synthesis-as-journal rule is upheld.

WSL investigation result: **the bug is in code, not environment.** DHBGAMING2's v2.4.0 install works because its sessions were captured via a non-CookieMonitor mechanism (manual Playwright export or browser-direct copy), bypassing the buggy capture path. The WSL environment itself is incidental. (Full analysis in `docs/phase-0/investigation-report.md`.)

---

## What the original plan said (and where it still holds)

Verified (no change needed):

| Plan element | Source | Holds? |
|---|---|---|
| Branch strategy: `phase0/regression-net` from `main@v2.6.1`, PRs to `main` | HTML §"Branch strategy", line 437-454 | ✅ The branch was cut correctly. |
| Three ticket-prefixed OpenSpec changes (tsk01/02/03) | HTML §"Phase 0 deliverable structure", line 191-219 | ✅ The change dirs were created. |
| Five cookie-jar writers; CookieJar unification = Candidate A | HTML §"The cookie jar today — four uncoordinated writers", line 89-138 | ✅ My investigation confirms 5 writers; Candidate A is the right shape. |
| ConversationThreading = Candidate B (5 call sites of the positional metadata array) | HTML §"Candidate B", line 280-346 | ✅ Unaffected by the Phase 0 misalignment; the bug `809240a` (cid-only fallback) trace supports it. |
| Candidates C (state machine), D (probe consolidation), E (post-call seam) | HTML §"Candidates C/D/E" | ✅ Unaffected; C/D still worth exploring; E folds into A as planned. |
| `fix/v2.6.1-bugs` scope: 11 commits addressing the bug | HTML §"Top recommendation" + synthesis doc §"The 4-cookie discovery" | ✅ Scope is correct. `6bc51f6` + 10 follow-ups all close related gaps. |
| Synthesis doc is a write-once ledger | HTML §"Synthesis-as-journal", line 228-241 | ✅ I appended an Appendix entry per the rule. |
| Branch strategy: `overhaul/cookie-jar-unification` off `main@v2.6.2` for Candidates A/B | HTML §"Top recommendation" #5, line 477 | ✅ Still the right sequencing. |

## Where the plan no longer holds (refined after the user's correction)

**Important context (per the user, 2026-08-08):** the architecture review was generated *after* testing against the HEAD of `fix/v2.6.1-bugs` — i.e. against the **fixed code**. The plan was not designed against the unfixed `main@v2.6.1` code. This affects how to read the misalignments:

| Plan element | Source | Issue |
|---|---|---|
| **Phase 0 tests are RED on prod v2.6.1** | HTML §"Phase 0 — The regression net", line 142-187; §"Expected state on prod: RED", line 178 | **NOT TRUE.** PR #19's 19 tests are GREEN on dev, prod, and fix branches. The fixture's cookie-aware fake is too idealized to exercise `cookie-monitor.ts:179`. |
| **"Iron-tight" merge gate** | HTML §"Why 'iron-tight'", line 184-185 | The framing required tests going RED on prod. Since tests are GREEN everywhere, the gate is non-functional. |
| **fix/v2.6.1-bugs gated by Phase 0 turning GREEN** | HTML §"Top recommendation" #2, line 474 | The gate is moot — Phase 0 is GREEN on `fix/v2.6.1-bugs` already (and on every other branch). |
| **merge-while-RED strategy** | HTML §"Branch strategy", line 463-465 | No RED to merge. The "holding would lose the prod-is-broken signal" argument doesn't apply. |
| **Phase 0 closes test gap #2 (no end-to-end test wires the real service stack)** | HTML §"Testing gaps", line 419-431 | **PARTIALLY.** PR #19 wired the full stack via the fixture, but the fixture stubs at the CookieMonitor seam. The actual `CookieMonitor.poll` capture path is still untested at the fixture layer. |

### Why the idealized fake fails to catch the bug

The fixture (`tests/helpers/full-stack-fixture.ts`) seeds cookies directly via `cookieStorage.save(profileName, options.seedCookies)`. It never instantiates `CookieMonitor`, never calls `AuthService.authenticate`, never invokes `driver.cookieListFromState`. The bug lives in `cookie-monitor.ts:179` which calls `onCookiesFound(authCookies)` (filtered) instead of `onCookiesFound(cookies)` (full jar). The fixture bypasses that path entirely.

In effect: the fixture tests *what happens if the jar is full vs. trimmed*, but does so by directly setting the jar state. It tests the *effect* of the bug, not the *cause*. The cause is in `CookieMonitor.poll` — un-exported closure, not reachable from the fixture.

This is the same gap the original plan identified as gap #2 in the testing-gaps table — "No end-to-end test wires the real service stack." The plan said Phase 0 closes it. PR #19 closed it partially (mediator + ProfileAuthManager + GeminiClientService seam) but missed the pre-mediator CookieMonitor capture path.

### The plan's design flaw (refined after the user's correction)

The architecture review was generated *after* testing against `fix/v2.6.1-bugs` HEAD (the fixed code). The plan author:

1. Took the cookie-aware fake design from `cookie-jar-repro.test.ts` (committed `efab987`, on `fix/v2.6.1-bugs`). That file's purpose is to *reproduce* the 4-cookie bug — it's a fixture specifically designed to expose the symptom. So the cookie-aware fake itself is a *bug-reproducer*, not a *bug-detector*.
2. Designed the Phase 0 fixture as a "constant-ok" version of that fake (HTML line 176-177: "cookie-aware fake is constant-ok for Phase 0 (Phase 0 tests the CLIENT, not server-side degradation)"). The "constant-ok" means the fake always returns OK regardless of jar state — i.e., it can't detect the bug.
3. Asserted in the test list (HTML line 158: "`ensureAuthenticated → listChats` returns ≥1 chat from a complete jar (catches capture-trim, the 4-cookie bug)") that Phase 0 catches the 4-cookie bug — but with a constant-ok fake, this assertion is impossible to satisfy as RED on prod.

The plan is internally inconsistent: the *tool* (constant-ok fake) cannot satisfy the *claim* (catches the 4-cookie bug). This is a design flaw, not an implementation flaw. PR #19 faithfully implements the flawed design.

The plan author almost certainly believed the "constant-ok" disclaimer was a forward-looking note about Candidate A's verification, not a statement about Phase 0's detection capability. But on close reading, the "constant-ok" applies to Phase 0, which structurally cannot catch the 4-cookie bug.

### The regression net that actually works

`tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`) drives `CookieMonitor` directly with a mock `PlaywrightCliDriver`:

```ts
const fullJar: Cookie[] = [...authCookies, ...companionCookies];

// ... driver.cookieListFromState.mockResolvedValue(fullJar); ...
// ... monitor.start("sess1", callback, 10_000); ...
expect(passed).toHaveLength(fullJar.length);  // PINNED: 7 cookies, not 2
```

This test goes RED on `main@v2.6.1` (callbacks receive 2 cookies because of the filter) and GREEN after `6bc51f6` (callbacks receive all 7 cookies). It is the actual gate the original plan was trying to build; it just lives in a different file than Phase 0 produced.

Note: the `gimme(modelsImpl)` pattern (HTML line 175) was promoted to the canonical test helper for `ProfileAuthManager`-level tests, but the deeper seam (CookieMonitor) needed its own contract test. The plan did not explicitly call out this seam; it's the missing piece the elaborate Phase 0 design was obscuring.

---

## How to reconcile

The original plan's vision is sound: ship a regression net that catches the bug, then deepen behind it. The implementation of Phase 0 missed because of the test-surface problem. The fix is small and preserves the plan's spirit.

### Corrected top-recommendation sequence

1. **Close PR #19** with a comment pointing at `docs/phase-0/investigation-report.md` and the actual regression net (`cookie-monitor.test.ts` on `fix/v2.6.1-bugs`).
2. **Keep `cookie-monitor.test.ts` on `fix/v2.6.1-bugs`** as the regression net at the right seam. (No code change — already there.)
3. **Merge `fix/v2.6.1-bugs` → `main`.** The 11 commits close the bug. The regression net goes GREEN on `main` after merge.
4. **Tag v2.6.2.** Ship.
5. **User re-auths on Windows-native** to repopulate full jar (existing 4-cookie jars not backfilled). One-time per profile.
6. **Branch `overhaul/cookie-jar-unification` off `main@v2.6.2`** for Candidate A (`CookieJar.apply(profile, source, policy)`). Each commit keeps `cookie-monitor.test.ts` GREEN.
7. **Then Candidate B (ConversationThreading), then C (state machine), then D (probe consolidation).** Each gated by the standing net.
8. **Journal every post-fix-failure event** into the synthesis doc per the write-once ledger rule.

### What this preserves from the original plan

- The 5-candidate taxonomy (A-E)
- The "regression net before deepening" principle
- The synthesis-as-journal convention
- The branch strategy (off `main@v2.6.2` for the overhaul)
- The fix branch's scope (no env-related changes; it was always correct)

### What this corrects

- The RED-on-prod gate (now lives on `cookie-monitor.test.ts`, not on Phase 0's idealized fixture)
- The merge-while-RED strategy (no longer needed; the regex net on `fix/v2.6.1-bugs` already proves the bug)
- The "Phase 0 closes gap #2" claim (closed partially; gap #7 — between CookieMonitor and the fixture — is closed by `cookie-monitor.test.ts`)

---

## What the user must decide

I cannot make this call unilaterally. The plan was approved by the user in a previous session; revising it requires user buy-in. The question above is correctly framed as a misalignment check, not a "do you want me to execute". The key decisions:

1. **Accept the misalignment as the price of learning.** Phase 0 (PR #19) is now an artifact of an honest attempt that revealed the regression net needs to live at the CookieMonitor seam, not the mediator seam. The actual gate (cookie-monitor.test.ts) was already on the fix branch. Phase 0's value is as a process-experiment finding, not as a gate.
2. **Revise the plan.** Close PR #19, merge fix branch, tag v2.6.2, branch the overhaul. The 5-candidate taxonomy stands.
3. **Reject the misalignment and try to make Phase 0 work as designed.** This would require: a) exposing CookieMonitor's callback payload as a testable seam (touching `src/`), b) rewriting the fixture to drive the real capture path, c) re-doing PR #19. Effort: ~1-2 days. Benefit: the original framing holds. Risk: the test surface might still not exercise the capture path correctly because `cookie-monitor.ts:179` is inside an interval-driven polling loop with a 2-second tick — driving that deterministically from a test is non-trivial (the test would need to wait for the tick or mock `setInterval`).

Option 3 is the most faithful to the plan's spirit but the most costly. Option 2 is the most pragmatic. Option 1 reframes Phase 0 as a process-experiment finding rather than a deliverable.

My recommendation: **Option 2.** The plan's broader vision (5 candidates, synth-as-journal, fix branch scope) is preserved; the Phase 0 implementation mistake is corrected without losing the regression-net principle.

---

## Artifacts in this decision

- `docs/phase-0/investigation-report.md` — full investigation report (this session)
- `docs/phantom-bug-synthesis.md` — Appendix entry "2026-08-08 — WSL investigation" (this session)
- `docs/phase-0/path-forward-revision.md` — this file
- `tests/services/cookie-monitor.test.ts` on `fix/v2.6.1-bugs` — the actual regression net (pre-existing, not modified)
- `tests/helpers/full-stack-fixture.ts` on `phase0/regression-net` — the idealized fake that motivated PR #19 (not modified)
- PR #19 — pending decision (close vs. revise)

No source code modified. No tests modified. No config modified. Typecheck clean. Tests 928 pass / 0 fail / 2 skip.
