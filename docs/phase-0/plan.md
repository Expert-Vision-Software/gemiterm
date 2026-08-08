# Phase 0 — Plan & Execution Spec

**Date:** 2026-08-07
**Status:** awaiting approval
**Branch:** `phase0/regression-net` (cut from `main` at v2.6.1)
**Target merge:** `main` (RED on prod is the intentional state)
**Companion doc:** `docs/phantom-bug-synthesis.md` (write-once ledger of bug history + post-fix-failure entries)
**Visual review:** `file:///C:/Users/diego/AppData/Local/Temp/architecture-review-auth-2026-08-07.html`

---

## What Phase 0 is

The regression net for the auth + chat modules. A characterization test suite that pins behavior at the integration boundary, so internal restructuring cannot silently reintroduce the regressions of the v2.6.0 → `0f9154f` saga.

**Phase 0's assertion contract must catch every regression in this table:**

| Regressed fix | What it broke | How Phase 0 catches it |
|---|---|---|
| 6bc51f6 (capture fix) | (was the root cause; Phase 0 prevents regression) | 0a asserts `listChats` returns ≥1 chat from a complete jar |
| a780788 (throttle) | (was the fix; the regression it prevented was silent throttle-defeat) | 0a asserts rotation runs when expected at T+30min / T+1hr |
| 4dfe13c (sessionInvalid) | (was the fix; the regression was 401 not surfaced) | 0a asserts dead-session throws AuthenticationError to factory |
| 9762845 (L2 removal) | (was the fix; the regression was cookie corruption) | 0a asserts jar after targeted-L2 still has companions |
| 809240a (continue fix) | "continue starts new chat" | 0a asserts `sendMessage(cid) → fetchChat(cid)` returns the new turn on same cid |
| b1d0df0 (PROBE column) | (additive; not a regression) | (covered by Candidate D separately) |
| 0f9154f (targeted L2) | (was the fix; the regression was full-merge replacing aligned envelope) | 0a asserts jar after recovery preserves PSID + companions |

Plus the unfixed bugs Phase 0 surfaces on `main`:

| Bug | Status on `main` | How Phase 0 catches it |
|---|---|---|
| profile-aware-factory-wiring | `cli/index.ts:119` wires `getGeminiClient()` (no profile arg) | 0b asserts `--profile <name>` is forwarded to ensureAuthenticated + rotateCookies |
| `forProfile(name).profileName` not asserted | untested | 0a asserts chatMetadata keyed to requested profile, not default |

---

## Deliverable structure (3 OpenSpec changes, ticket-prefixed)

```
openspec/changes/
├── tsk01-phase0-regression-net-char/
│   ├── .openspec.yaml
│   ├── proposal.md
│   ├── design.md
│   ├── tasks.md
│   ├── specs/
│   │   └── phantom-auth-detection/spec.md    ← delta: new requirement
│   └── tests/
│       ├── helpers/
│       │   └── full-stack-fixture.ts        ← new module
│       └── services/
│           └── regression-net.test.ts        ← the 0a characterization
├── tsk02-phase0-factory-coverage/
│   ├── .openspec.yaml
│   ├── proposal.md
│   ├── design.md
│   ├── tasks.md
│   ├── specs/
│   │   └── cli/spec.md                       ← delta: new requirement
│   └── tests/
│       └── cli/
│           └── get-gemini-client.test.ts    ← the 0b factory tests
└── tsk03-phase0-synthesis-journal/
    ├── .openspec.yaml
    ├── proposal.md
    ├── design.md
    └── tasks.md                              ← doc-only; no spec delta
```

The three changes may be **three commits on the same branch** (`phase0/regression-net`) or **three PRs to `main`**. Default: three commits, one branch, one PR (per Q6 sequencing).

**Ticket ids:** `tsk01..tsk03` are placeholders. Rename to your tracker's numbering (e.g. `tsk12-`, `tsk14-`, `tsk15-`) if the tracker already has these slots reserved.

---

## Proposal 1 · tsk01-phase0-regression-net-char

### Why

Every prior phantom-auth fix shipped green but burned live. The reason is that **no test wires the real service stack end-to-end** — every test stubs at the service seam. Phase 0 closes this.

### What Changes

- New `tests/helpers/full-stack-fixture.ts` exporting `buildFullStack({ profileName, jarShape, clock, sdkResponses })`.
- New `tests/services/regression-net.test.ts` (or `tests/integration/regression-net.test.ts`) covering:
  - **Round-trip:** `ensureAuthenticated → listChats → sendMessage(cid) → fetchChat(cid)`
  - **Jar completeness** at every step (companions + PSID + PSIDTS present)
  - **Conversation threading:** `fetchChat(cid)` returns the turn added by `sendMessage(cid)`
  - **Profile routing:** `chatMetadata` keyed to requested `profileName`
  - **Time-passing:** at T+30min and T+1hr (via injected `now()`), the full round-trip still passes
  - **Cookie freshness boundary:** `__Secure-1PSIDTS.expires` set at the 7-day boundary so `autoExtendSession` triggers at T+8d
- OpenSpec delta to `openspec/specs/phantom-auth-detection/spec.md`: new requirement pinning the regression net contract.

### Capabilities

#### Modified Capabilities

- `phantom-auth-detection` — add a `Requirement: Phase-0 regression net pins behavior` requirement that asserts the round-trip + threading + profile routing + time-passing contract.

### Impact

- Code touched: `tests/helpers/full-stack-fixture.ts` (new), `tests/services/regression-net.test.ts` (new), `openspec/specs/phantom-auth-detection/spec.md` (delta).
- No production code changes.
- `package.json` deps: none.
- Test count: +1 file, ~6-10 tests.

### Tasks

1. Create `tests/helpers/full-stack-fixture.ts` exporting `buildFullStack`.
2. Reuse `gimme(modelsImpl)` pattern from `tests/services/phantom-auth.test.ts:155` for the cookie-aware fake.
3. Add injected `now()` to `CookieStorage` consumers (mirroring `cookie-rotation.ts:30`).
4. Write `tests/services/regression-net.test.ts` with 6 test cases.
5. Verify RED on `main@v2.6.1` (`bun test tests/services/regression-net.test.ts` exits non-zero).
6. Add OpenSpec delta to `phantom-auth-detection/spec.md`.
7. Commit.

---

## Proposal 2 · tsk02-phase0-factory-coverage

### Why

`src/cli/index.ts` (the `getGeminiClient` factory that caches clients + runs reauth-retry + wires `--profile`) has **zero direct tests**. `tests/cli/index.test.ts` exists but tests a different file (`reauth.ts`). The "wrong profile's client" bug (`profile-aware-factory-wiring`) hides in this factory. The reauth prompt never fires after a 401 hides here too. Phase 0 closes both.

### What Changes

- New `tests/cli/get-gemini-client.test.ts` covering:
  - **Cache hit:** second call returns same client (after warm-up).
  - **Cache miss:** first call builds; second returns cached.
  - **`AuthenticationError → reauth prompt → retry succeeds`:** client throws, factory catches, reauth flow re-builds, returns new client.
  - **`AuthenticationError + user-declines reauth`:** factory re-throws.
  - **`--profile <name>` forwarding:** factory invokes `ProfileAuthManager.ensureAuthenticated(name)` not `getDefaultProfileName()`.
  - **Non-TTY:** prompt throws `NonInteractiveError`; factory re-throws original `AuthenticationError`.
- OpenSpec delta to `openspec/specs/cli/spec.md`: new requirement on the factory contract.

### Capabilities

#### Modified Capabilities

- `cli` — add a `Requirement: getGeminiClient factory cache and reauth-retry contract` requirement.

### Impact

- Code touched: `tests/cli/get-gemini-client.test.ts` (new). Optionally rename or merge `tests/cli/index.test.ts` (currently misnamed).
- No production code changes.
- Test count: +1 file, ~6-8 tests.

### Tasks

1. Read `src/cli/index.ts` lines 40-202 (`setupMediator`, `getGeminiClient`, `buildClient`, `promptAndReauth`).
2. Create `tests/cli/get-gemini-client.test.ts` with the 6 cases above.
3. Stub `authService.authenticate`, `profileAuthManager.ensureAuthenticated`, `prompts.confirm` via DI seams.
4. Verify RED on `main@v2.6.1` (the wrong-profile-routing case fails; the cache hit case fails because no current test pins it).
5. Add OpenSpec delta to `cli/spec.md`.
6. Commit.

---

## Proposal 3 · tsk03-phase0-synthesis-journal

### Why

Per grilling: every new fix addressing phantom-auth must journal an entry into the bug ledger. Without this rule, knowledge of past regressions fades and the same mistakes repeat.

### What Changes

- Rename `docs/phantom-auth-synthesis-2026-08-06.md` → `docs/phantom-bug-synthesis.md` (done this session, `git mv` preserves history).
- Adopt the write-once ledger convention in the new file's header (done this session).
- Append the empty `## Appendix · new entries after 2026-08-06` section with the entry template (done this session).
- OpenSpec change dir `tsk03-phase0-synthesis-journal/` with proposal/design/tasks describing the rule (no spec delta; doc-only).

### Capabilities

No spec delta. Doc-only.

### Impact

- Code touched: `docs/phantom-bug-synthesis.md` (renamed + convention header + appendix added). `git mv` preserves history.
- No production code, no test code, no spec delta.
- Doc-only OpenSpec change (lightest of the three).

### Tasks

1. Verify the rename + convention header + appendix are committed.
2. Add the journaling rule to `openspec/changes/tsk03-phase0-synthesis-journal/tasks.md` as the explicit commitment.
3. Commit.

---

## Sequencing

```
phase0/regression-net (cut from main@v2.6.1)
│
├── commit 1: tsk03 (docs only — write-once ledger commitment + OpenSpec change dir)
├── commit 2: tsk01 (0a characterization test — RED on prod)
└── commit 3: tsk02 (0b factory test — RED on prod)
│
└── PR → main
    │
    └── main now carries Phase 0 (RED, CI fails as intended)
        │
        ├── fix/v2.6.1-bugs re-merges main (Phase 0 in)
        │   └── must turn Phase 0 GREEN before closing
        │       └── live-verify (user-driven, 30-min/1-hr phantom-auth repro)
        │           └── merge fix → main, tag v2.6.2
        │               └── branch overhaul/cookie-jar-unification off main@v2.6.2
```

---

## Assertion contract (the exact shape of "green")

The Phase 0 characterization test passes when ALL of the following hold for every snapshot in the round-trip:

| Assertion | Method | T+0 | T+30min | T+1hr |
|---|---|---|---|---|
| Jar has companions (≥1 of SID/HSID/SSID/APISID/SAPISID/SIDCC) | inspect `loadAllCookiesForProfile` | ✓ | ✓ | ✓ |
| `models()` succeeds | fake SDK response | ✓ | ✓ | ✓ |
| `listChats()` returns ≥1 chat | fake SDK response | ✓ | ✓ | ✓ |
| `sendMessage(cid)` returns text | fake SDK response | ✓ | ✓ | ✓ |
| `fetchChat(cid)` returns the turn added by `sendMessage` | fake SDK response | ✓ | ✓ | ✓ |
| `chatMetadata.lookup(profileName, cid)` has rid/rcid matching the fake's last-model-turn | inspect `chatMetadata` | ✓ | ✓ | ✓ |
| `persistRefreshedCookies` did NOT corrupt companions | inspect `loadAllCookiesForProfile` post-call | ✓ | ✓ | ✓ |

If any of these fails at T+0, T+30min, OR T+1hr, Phase 0 is RED.

---

## Helpers & seams

- `tests/helpers/full-stack-fixture.ts` — `buildFullStack({ profileName, jarShape, clock, sdkResponses })` returns:
  - `profileManager` (real, in-memory)
  - `cookieStorageService` (real, tmp-dir backed)
  - `chatMetadataStorage` (real, tmp-dir backed)
  - `geminiClient` (cookie-aware fake via `gimme(modelsFn, listChatsFn)`)
  - `logger` (silent)
  - `profileAuthManager` (real, wired to the above)
  - `clock` (injected `now()`)
  - `serverBehavior` (default: constant-ok; settable via `setServerBehavior({ modelsThrows?, listChatsReturns? })`)

- Existing seams reused: `gimme(modelsImpl)` from `tests/services/phantom-auth.test.ts:155`, `now?: () => number` from `cookie-rotation.ts:30`, constructor-DI everywhere.

---

## Risks & guards

- **RED on `main` while merged blocks v2.6.1 patches.** Acceptable: v2.6.1 is shipped; only `fix/v2.6.1-bugs` is the active branch that should touch `main` next, and it's gated on GREEN. If a hotfix lands, it would need to either (a) come through `fix/v2.6.1-bugs` and turn Phase 0 GREEN too, or (b) temporarily allow RED merges (escalate to user).
- **`persistRefreshedCookies` writes during 0a tests.** Will cause cookie-jar mtime churn; Phase 0 should use a fresh `tmpdir` per test to isolate.
- **`forProfile` async-init races.** The factory's `initPromise` is per-instance; tests must await it explicitly.
- **Real-SDK smoke is NOT in Phase 0.** It's a Candidate A verification step, not Phase 0.

---

## Approval checklist (user)

Before the next session begins:

- [ ] Branch strategy confirmed (Phase 0 on `main` while RED; `fix/v2.6.1-bugs` gated).
- [ ] Ticket-id prefix aligned with tracker (`tsk01..03` or renumbered).
- [ ] Synthesis doc: moved to `docs/phantom-bug-synthesis.md` via `git mv` (history preserved); §Phase 0 framing stripped (was planning); header now states write-once ledger convention. ✓ Done.
- [ ] Phase 0 commits: 3 commits on `phase0/regression-net`, 1 PR to `main` (default).
- [ ] Test-baseline bump: skip BL promotion until both 0a and 0b land; promote BL-010 → BL-011 then.
- [ ] CHANGELOG: skip (test-only).
- [ ] Handoff document in temp dir references this plan, the synthesis journal, and the HTML report.

---

## See also

- `docs/phantom-bug-synthesis.md` — bug biography (write-once ledger; new entries appended under the appendix)
- `CONTEXT.md` — domain glossary (cookie jar, phantom-auth, capture-integrity, regression net, cookie-aware fake)
- `docs/agents/issue-tracker.md` — GitHub issue tracker + `tskNN-` ticket-id convention
- `docs/agents/domain.md` — domain doc layout + write-once ledger convention
- `docs/agents/triage-labels.md` — five-role triage label vocabulary
- `architecture-review-auth-2026-08-07.html` (temp) — visual review with 5 deepening candidates
- `openspec/specs/phantom-auth-detection/spec.md` — capability spec receiving the delta
- `openspec/specs/cli/spec.md` — capability spec receiving the factory delta
