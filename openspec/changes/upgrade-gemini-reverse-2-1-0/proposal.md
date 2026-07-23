# Proposal: Upgrade gemini-reverse 1.0.12 → 2.1.0

## Why

We pinned `gemini-reverse` to `~1.0.12` after the 1.1.x line renamed
`GeminiClient` → `Gemini` and broke fresh installs (`SyntaxError: Export named
'GeminiClient' not found`, issue #5). The upstream 2.x line (current: `2.1.0`,
published 2026-06-23, nothing since) is a full rewrite that adds built-in
retry-with-backoff, a zombie-stream watchdog with dropped-connection recovery,
and the current Gemini 3 model catalog — reliability fixes we currently absorb
as user-facing failures. Staying on the abandoned 1.0.x line accumulates
protocol drift against the live Gemini web app with no upstream fixes.

## What Changes

- **Bump `gemini-reverse` from `~1.0.12` to exactly `2.1.0`** in
  `package.json` (exact pin, no range — upstream broke API inside the 1.x
  line; see design.md Decision D1).
- **BREAKING (upstream, absorbed internally):** rewrite the internals of
  `src/services/gemini-client-wrapper.ts` onto the 2.1.0 API. The wrapper's
  own public surface — `GeminiClientService`, `IGeminiClientService`,
  `IGeminiClientQueryService`, all method signatures, domain types, and thrown
  error types — is preserved bit-identical; no other `src/` file changes.
  - `GeminiClient` → `Gemini`; constructor takes
    `{ secure_1psid, timeout, autoClose, ... }` (no `secure_1psidts`; injected
    into `client.cookies` post-construction for parity).
  - `init(opts)` → `init()`; `autoRefresh`/`refreshInterval` removed upstream
    (cookie rotation replaced by passive `set-cookie` merging per response).
  - `listChats()` (sync, `ChatInfo[]`) → `chats()` (async, `unknown[]` of
    plain `{ cid, title, pinned, timestamp }` — field `is_pinned` renamed to
    `pinned`).
  - `readChat()` → returns a plain turn array
    `[{ role: string, text, thoughts?, images?, ... }]` instead of
    `ChatHistory { cid, turns }`; empty result is `[]`, not `null`.
  - `startChat({ cid })` → `newChat()` + `session.cid = cid`;
    `session.sendMessage()` → `session.generateContent({ prompt })`.
  - `listModels()` (sync, account-probed) → `models()` (async, static
    catalog of 10 Gemini 3 entries).
  - `TimeoutError` removed upstream — timeouts surface as raw axios
    `ECONNABORTED` errors or stalled-stream `APIError`s; our timeout message
    ("Request to Gemini timed out") is preserved via a new translation branch.
- **Phase 0 — test hardening landed BEFORE the version bump** (passes on
  1.0.12): a new package-surface contract smoke test (every export we consume,
  asserted by kind) and a real-client construction smoke test (constructor
  contract, no network). These make any future upstream rename/removal a CI
  failure instead of a user report.
- **Phase 1 — the upgrade commit:** flip the contract test to the 2.1.0 names,
  update `tests/smoke/gemini-reverse-import.test.ts` (`GeminiClient` →
  `Gemini`), rebuild the `tests/services/gemini-client-wrapper.test.ts` module
  mock to mirror the real 2.1.0 payload shapes (plain chat rows, turn arrays,
  `generateContent`), and add coverage for the three silent-regression
  candidates: `pinned` → `isPinned` mapping, axios-timeout translation, and
  `models()` display mapping.
- **Visible behavior note:** `gemiterm models` output content changes (static
  Gemini 3 catalog instead of an account-probed registry). Field-preference
  decision recorded in design.md (D2). All other CLI output is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — this is a behavior-preserving dependency upgrade. Following the
precedent of the archived
`2026-06-09-replace-gemini-api-placeholder-with-gemini-reverse` change, the
delta spec is `specs/no-capability-changes/spec.md` asserting the preserved
public contract. No requirement in `openspec/specs/conversations`,
`multi-profile-conversations`, `commands`, `auth`, or any other capability is
modified.

## Impact

- **Code:** `src/services/gemini-client-wrapper.ts` (the only file importing
  `gemini-reverse`) — internals rewritten; public surface unchanged. No other
  `src/` file is touched.
- **Tests:** new `tests/smoke/gemini-reverse-contract.test.ts`; updated
  `tests/smoke/gemini-reverse-import.test.ts`; rebuilt mock + new cases in
  `tests/services/gemini-client-wrapper.test.ts`. Baseline preserved:
  `bun test` green (657 pass / 0 fail at authoring time — re-verify at
  implementation), `bun run typecheck` clean, `bun run lint:mediation` clean.
- **Dependencies:** `gemini-reverse` `~1.0.12` → `2.1.0` (exact). Transitive
  deps unchanged (axios, form-data, uuid); still CommonJS — Bun interop
  verified against the 2.1.0 tarball.
- **Verification:** automated suite + a manual live checklist against a real
  account (list/list -i/fetch/send/new/continue/models/delete/status,
  multi-profile) — no automated live tests exist by design.
- **Explicitly out of scope:** adopting new 2.1.0 features (guest mode,
  streaming, generated media, deep research, gems) and **persisting refreshed
  cookies back to disk** — the latter is a deliberate follow-up tracked as the
  separate change `persist-refreshed-cookies`.
