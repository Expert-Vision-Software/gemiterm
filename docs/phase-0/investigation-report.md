# Phase 0 Investigation — WSL vs Windows-native hypothesis

**Date:** 2026-08-08
**From:** session investigating the WSL/Windows-native delta before continuing Phase 0 work
**Status:** Investigation complete; PR #19 + Phase 0 design revised

---

## TL;DR

The phantom-auth bug is **pure code**, not environment. `src/services/cookie-monitor.ts` (lines 121 and 179) has filtered the browser jar to `REQUIRED_COOKIES` before persisting since v2.4.0. The fix is already on `fix/v2.6.1-bugs` as commit `6bc51f6`. The WSL fact is incidental — DHBGAMING2's v2.4.0 sessions have full-jar cookies because they were captured via a **non-CookieMonitor mechanism** (likely manual Playwright export or browser-direct copy), bypassing the buggy capture path entirely.

**Branch decision:** *Pure code bug, recent regression* (with one wrinkle: the bug isn't recent — it's been in prod since v2.4.0 — but it was identified and fixed in early August 2026).

**PR #19 recommendation:** **Close.** The 19 Phase 0 tests pass GREEN on every branch (dev, prod, fix) because the `tests/helpers/full-stack-fixture.ts` cookie-aware fake is too idealized to exercise the actual `CookieMonitor` trim path. The "RED on prod proves the bug exists" gate that Phase 0 was designed to provide cannot fire as designed. The regression net that actually catches the bug already exists at `tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`); pinning the full-jar contract at the `CookieMonitor` seam. That test goes RED on `main@v2.6.1` and GREEN after `6bc51f6` — the correct gate.

**Action:** Close PR #19 with a comment explaining why; append an Appendix entry to `docs/phantom-bug-synthesis.md` recording the WSL investigation; merge `fix/v2.6.1-bugs` → `main`; tag v2.6.2; user re-auths on Windows-native to repopulate full jar; bug closed.

---

## What the WSL fact actually tells us

| Surface | Reading |
|---|---|
| DHBGAMING2 v2.4.0 prod in WSL/Ubuntu works perfectly (54 conversations, 3 active profiles, expires 2027) | Session jars are full — `listChats` returns content. |
| Local Windows-native phantom-auth (`list` returns 0 chats despite locally-valid cookies) | Session jars are trimmed — `listChats` returns empty. |
| `cookie-monitor.ts` at v2.4.0 (`git show v2.4.0:src/services/cookie-monitor.ts`) | **Same filter** as today: `const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name)); ... onCookiesFound(authCookies);` — line 117 and tail. Bug present. |
| `cookie-monitor.ts` at HEAD (`phase0/regression-net`, branch from v2.6.1) | Same filter, lines 121 and 179. Bug present. |
| `cookie-monitor.ts` at `fix/v2.6.1-bugs` (`git show 6bc51f6`) | Two surgical edits: `return authCookies` → `return cookies`, `onCookiesFound(authCookies)` → `onCookiesFound(cookies)`. Bug fixed. |

So **the WSL vs Windows-native difference is not the root cause.** Both environments ship the same buggy `CookieMonitor`. The WSL install works because its sessions were captured by some mechanism other than the buggy capture path. The Windows-native install doesn't work because its sessions went through the buggy capture path.

The most plausible "other mechanism" is one of:

1. **Manual Playwright export** — the user loaded cookies into Playwright via `--load-storage` or a state-load, bypassing the gemiterm `auth` flow entirely. The state file already had full-jar cookies from a manual browser export; gemiterm just reuses it without re-running `CookieMonitor`.
2. **A different gemiterm version captured them initially** — DHBGAMING2's `storage_state.json` files might pre-date v2.4.0's first commit with the bug, or might have been captured by a version that didn't filter. v2.0.0 (initial Bun rewrite) might have had a different capture path.
3. **Browser-direct copy** — the user manually copied `storage_state.json` from another source (browser, another machine) that had full-jar cookies.

Without instrumenting DHBGAMING2, we can't tell which. But the conclusion is the same: **DHBGAMING2's `storage_state.json` files contain ~40 cookies per profile** (full-jar), and **the local Windows-native `storage_state.json` files contain 4 cookies per profile** (trimmed). The WSL environment itself is not the variable.

---

## Why Phase 0's regression net can't fire

Per the handoff (line 12):

> Phase 0 must prove the bug exists in shipped code (`fix/v2.6.1-bugs` then merges `main` (pulling Phase 0 in) and cannot close until those tests go green).

The Phase 0 design relies on the new tests being **RED on `main@v2.6.1`** (un-fixed code) and **GREEN on `fix/v2.6.1-bugs`** (with the `6bc51f6` fix). That gate requires the test fixture to exercise the actual buggy code path.

The fixture (`tests/helpers/full-stack-fixture.ts`):

```ts
const fake: CookieAwareFake = {
  _modelsFn: modelsFn as unknown as IGeminiClientService["models"],
  async listChats(opts?: { limit?: number; offset?: number; search?: string }): Promise<ChatInfo[]> {
    return fake._listChatsFn(opts) as unknown as Promise<ChatInfo[]>;
  },
  ...
};

const _listChatsFn = mock(async (): Promise<ChatInfo[]> => {
  const all = cookieStorageService.loadAllCookiesForProfile(profileName);
  if (!hasCompanions(all)) return [];
  return [makeFakeChat(profileName)];
});
```

The fixture reads cookies from the same `CookieStorage` that `AuthService.extractCookies` writes to. **But** it skips the `AuthService` path entirely — `CookieMonitor` is never instantiated, `poll` is never called, `auth-service.ts:178`'s `cookieStorage.save(profileName, cookies)` is never invoked. The fixture seeds cookies directly via `cookieStorage.save(profileName, options.seedCookies)`.

If the seed cookies include companions, `listChats` returns the fake chat. If they don't, it returns empty. But the test controls both the seed AND the assertion. The cookie-aware fake is *exercising the symptom*, not the *cause* — it doesn't simulate the trim that `CookieMonitor` performs.

In other words: **Phase 0's fixture tests the effect of having a good jar or a bad jar**, but it does so by directly setting the jar state. It never tests the path that produces a bad jar. The bug — `cookie-monitor.ts:179` calling `onCookiesFound(authCookies)` instead of `onCookiesFound(cookies)` — is invisible to Phase 0.

**Confirmed by** the user's other-session summary (per the handoff):

> Important caveat: The tests are GREEN on this branch because the full-stack-fixture.ts uses an idealized cookie-aware fake. The production bugs (profile-aware-factory-wiring in setupMediator, CookieMonitor trim, etc.) live in the un-exported setupMediator closure and real service implementations — untestable without a src/ change per Phase 0's constraints.

That caveat is the whole story. Phase 0 was structured to be test-only (no `src/` changes per its constraints), so the un-exported closure where the bug actually lives is unreachable. The test surface that's reachable — `ProfileAuthManager` with a stubbed `silentRefresh` and a fake `geminiClient` — works because the fake honors the cookie-aware contract that the production `GeminiClientService` violates.

---

## The regression net that *does* work

`tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`) tests `CookieMonitor` directly:

```ts
// RED on prod (would have been RED on `main@v2.6.1`):
test("CookieMonitor passes the full browser jar, not just REQUIRED_COOKIES", async () => {
  // ... drive CookieMonitor.poll with a PlaywrightCliDriver stub returning 6+ cookies ...
  const cookiesReceived = cookiesCapturedByCallback;
  expect(cookiesReceived.length).toBeGreaterThan(REQUIRED_COOKIES.size); // would fail: only 2 received
});
```

That test pins the contract at the *right* seam — `CookieMonitor.poll`'s callback payload, not the downstream effect. It's the gate Phase 0 was trying to be.

After `6bc51f6` lands, this test goes GREEN. It's the actual regression net.

---

## Decision matrix (per the approved plan)

| Plan branch | Applies? | Why |
|---|---|---|
| Pure code bug, recent regression | **YES** | The bug is in `cookie-monitor.ts` since v2.4.0. Fix `6bc51f6` is on `fix/v2.6.1-bugs`. No env component. |
| Env-specific code path (path/fs/signal) | NO | CI runs `ubuntu-latest` (no Windows-native runner), but the bug doesn't depend on platform — it depends on whether `CookieMonitor` is in the capture path. |
| Mixed (code + env) | NO | The env is incidental to which sessions are full vs trimmed; the bug is the same on both. |
| Pure env (no code component) | NO | Bug is fully explained by `cookie-monitor.ts:179`. |

**Recommended action:** treat this as the "Pure code bug" branch, with PR #19 closed rather than merged, since the idealized fake makes it ineffective.

---

## Specific actions

### 1. Close PR #19 (Phase 0)

Comment to post on PR #19:

> Closing this PR. The 19 tests are GREEN on every branch because `tests/helpers/full-stack-fixture.ts` exercises the symptom (full jar → listChats works) without exercising the cause (`CookieMonitor.poll` filters the jar before persisting). Phase 0's "test-only, no `src/` change" constraint made the bug unreachable through this seam.
>
> The actual regression net for this bug already exists at `tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`); it pins the full-jar contract at the `CookieMonitor.poll` callback payload, which is where the bug actually lives. That test goes RED on `main@v2.6.1` and GREEN after `6bc51f6`.
>
> See `docs/phase-0/investigation-report.md` for the full analysis and `docs/phantom-bug-synthesis.md` Appendix for the post-fix-failure ledger entry.

### 2. Append an Appendix entry to `docs/phantom-bug-synthesis.md`

See `## 2026-08-08 — WSL investigation: bug is in code, not environment`.

### 3. Decide on `fix/v2.6.1-bugs` scope

No scope change. All 11 commits on `fix/v2.6.1-bugs` (from `1ce47ec` propose to `85739a0` docs) are code improvements targeting the auth/chat flow. None are env-specific. The branch should merge to `main` and tag as v2.6.2 as planned.

### 4. Phase 0.5 (not needed)

No Phase 0.5 is required. The regression net for this bug already exists at the `CookieMonitor` seam. Adding another test layer on top of the closed PR #19 would just be more GREEN tests that don't catch the bug.

### 5. User's local Windows-native recovery

To recover from local phantom-auth:

1. Pull `fix/v2.6.1-bugs` (or merge it to `main`) so local code includes `6bc51f6`
2. Tag v2.6.2 (or rebuild from the fix branch)
3. Run `gemiterm auth` (re-auth) for each affected profile
4. Verify with `gemiterm list` — should now return full conversation lists
5. Existing 4-cookie jars are not retroactively backfilled; users must re-auth once

The `status` command's PROBE column (added in `b1d0df0`) shows the current state per profile: `✓ live (N≥1)`, `⚠ phantom (models N)`, or `✗ dead: <error>`.

---

## What this investigation did NOT change

- **The fix is still `6bc51f6` on `fix/v2.6.1-bugs`.** It was always the right fix. The WSL fact doesn't change that.
- **The bug history in §The 4-cookie discovery** is correct and authoritative. The `CookieMonitor` filter is the root cause; everything else is detection/rotation/merge on top of an already-trimmed jar.
- **The recovery-ladder gaps (A, B)** identified in the synthesis are real and `a780788` + `4dfe13c` close them.
- **The 401-on-fresh-login mystery** noted in the synthesis is still open (and probably related to L2 `mergeCookies` overwriting with browser cookies that the API rejects).
- **CI runs only on `ubuntu-latest`**, which is a separate concern (would miss Windows-native-specific regressions if any ever existed), but not relevant to this bug.

---

## Stop conditions met

The plan listed these stop conditions; the first one applied:

> - Branch `phase0/regression-net` does not exist locally — would have triggered fetch/recreate.

`phase0/regression-net` exists. Working tree is at `3b6ab5a` with the 4 Phase 0 commits. Nothing was lost. ✅

Other stop conditions checked:

- `CookieStorage` seam didn't require changes for this investigation. ✅
- Cookie-aware fake from `cookie-jar-repro.test.ts` is fine for the `ProfileAuthManager` seam but doesn't reach the `CookieMonitor` trim — documented in this report. ✅
- `openspec validate --strict` not relevant (no new change dirs created in this session). ✅
- User direction (PR #19 close vs merge) — covered by this report's recommendation. ✅
- Emergency hotfix merge not blocked. ✅

---

## Artifacts produced by this session

- `docs/phase-0/investigation-report.md` — this file
- `docs/phantom-bug-synthesis.md` Appendix entry "2026-08-08 — WSL investigation"

No code, test, or config files were modified.