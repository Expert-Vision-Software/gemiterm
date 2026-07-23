# Tasks: Upgrade gemini-reverse 1.0.12 → 2.1.0

Design reference: `design.md` (decisions D1–D8, verified API mapping table).
Baseline to preserve: `bun test` 657 pass / 0 fail, `bun run typecheck` clean
(re-verify the count when starting; update this line if it has moved).

## 1. Phase 0 — contract safety net (lands on `~1.0.12`, must pass pre-bump)

- [ ] 1.1 Create `tests/smoke/gemini-reverse-contract.test.ts` with the
  surface-contract test (design D8.1): real `await import("gemini-reverse")`,
  assert `GeminiClient` is a constructible function; `AuthError`, `APIError`,
  `GeminiError`, `TimeoutError`, `UsageLimitExceeded`, `ModelInvalid`,
  `TemporarilyBlocked` are functions whose prototypes chain to `Error`;
  `GeminiClient.prototype` has `init`, `close`, `listChats`, `readChat`,
  `deleteChat`, `startChat`, `listModels`.
- [ ] 1.2 Add the constructor-contract test (design D8.2) to the same file:
  `new GeminiClient({ secure_1psid: "dummy" })` succeeds with no network
  (no `init()`) and `instance.cookies["__Secure-1PSID"] === "dummy"`.
- [ ] 1.3 Run `bun test` and confirm the baseline holds with the 2 new tests
  passing (657 → 659).

## 2. Phase 1 — dependency bump

- [ ] 2.1 `package.json`: change `"gemini-reverse": "~1.0.12"` to
  `"gemini-reverse": "2.1.0"` (exact pin, design D1); run `bun install`;
  confirm `bun.lock` resolves `gemini-reverse@2.1.0`.
- [ ] 2.2 Flip the Phase 0 contract test to the 2.1.0 surface: expect `Gemini`
  (constructible), prototype methods `init`, `close`, `newChat`, `chats`,
  `readChat`, `deleteChat`, `models`; drop `TimeoutError` from the error-class
  assertions; assert `GeminiClient` and `TimeoutError` exports are absent.
- [ ] 2.3 Update `tests/smoke/gemini-reverse-import.test.ts`: assert
  `geminiReverse.Gemini` (replacing `GeminiClient`).

## 3. Phase 1 — wrapper rewrite (design D2–D7; public surface unchanged)

- [ ] 3.1 Imports: replace `GeminiClient`/`TimeoutError` and the removed
  option types with `Gemini` + 2.1.0 types (`GeminiOptions` etc.); keep the
  remaining error-class imports.
- [ ] 3.2 Constructor + `init()` (D3): `new Gemini({ secure_1psid, timeout: 300_000, autoClose: false })`;
  inject `__Secure-1PSIDTS` into `client.cookies` when configured; call
  `init()` with no options; keep the idempotency guard and
  `isAuthenticated()` semantics.
- [ ] 3.3 `listChats` (D5): `await client.chats()`; local `RawChatRow`
  interface `{ cid, title, pinned, timestamp }`; map `pinned` → `isPinned`;
  keep search/sort/limit/offset logic identical.
- [ ] 3.4 `fetchChat` (D6): map the returned turn array directly; narrow
  `role` via `turn.role === "model" ? "model" : "user"`; empty/falsy → `[]`.
- [ ] 3.5 `sendMessage` / `startNewChat` (D4): `client.newChat()` +
  `session.cid = conversationId` for resume; `session.generateContent({ prompt })`;
  `session.cid` for the new conversation id; `output.text.toString()` as today.
- [ ] 3.6 `listModels` (D2): `await client.models()`; fallback chain
  `model_name || display_name || model_id`.
- [ ] 3.7 `translateError` (D7): remove the `TimeoutError` branch; add
  axios/stalled-stream detection (`code === "ECONNABORTED"` or
  APIError/GeminiError message matching `/\b(timed out|timeout|stalled)\b/i`)
  → `GeminiAPIError("Request to Gemini timed out")`; leave all other branches
  untouched.

## 4. Phase 1 — rebuild wrapper tests to 2.1.0 shapes

- [ ] 4.1 Rebuild the `mock.module("gemini-reverse", …)` factory in
  `tests/services/gemini-client-wrapper.test.ts` to mirror real 2.1.0 shapes
  (cite upstream source lines in a comment): `Gemini` class mock with async
  `chats()` returning plain `{ cid, title, pinned, timestamp }` rows,
  `readChat()` returning turn arrays, `newChat()` returning a session with
  `generateContent` + settable `cid`, async `models()`, no `TimeoutError`.
- [ ] 4.2 Keep all existing domain-level assertions (sorting, search,
  limit/offset, timestamp ms conversion, profile scoping, init idempotency,
  error translations) passing against the rebuilt mock; adjust only the
  mock-side shapes, not the assertion intent.
- [ ] 4.3 Add the silent-regression guards: (a) `pinned: true` row →
  `isPinned: true`; (b) timeout fixtures (`{ code: "ECONNABORTED" }` and an
  `APIError("Response stalled (zombie stream).")`) → "Request to Gemini timed
  out"; (c) `models()` mapping prefers `model_name`, falls back to
  `display_name` then `model_id`.

## 5. Verification

- [ ] 5.1 `bun test` — full suite green at the preserved baseline (+ the new
  Phase 0/guard tests); `bun run test:unit`, `bun run test:integration`,
  `bun run test:smoke` individually green.
- [ ] 5.2 `bun run typecheck` clean; `bun run lint:mediation` (bash form)
  clean; `bun run build` succeeds.
- [ ] 5.3 Manual live checklist against a real account (no automated live
  tests by design): `auth` (login flow unchanged), `list` (pinned marker
  intact), `list -i`, `fetch`, `send`, `new`, `continue`, `models` (static
  Gemini 3 catalog, informative names per D2), `delete`, `status`,
  `list --profile <alt>` (multi-profile scoping).
- [ ] 5.4 `CHANGELOG.md`: new entry documenting the upgrade, the exact-pin
  policy (issue #5 context), and the `gemiterm models` output change.
- [ ] 5.5 Commit as two commits: Phase 0 safety net, then the upgrade
  (conventional-commits style, e.g. `test(gemini): add gemini-reverse surface
  contract tests` then `chore(deps): upgrade gemini-reverse to 2.1.0`).
