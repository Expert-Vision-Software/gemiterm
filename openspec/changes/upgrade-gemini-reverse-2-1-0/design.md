# Design: Upgrade gemini-reverse 1.0.12 → 2.1.0

## Context

`gemini-reverse` is the npm library backing all Gemini traffic. We pinned
`~1.0.12` after the 1.1.x line renamed `GeminiClient` → `Gemini` and broke
fresh installs (issue #5, see `CHANGELOG.md`). The only file in `src/`
importing the library is `src/services/gemini-client-wrapper.ts`
(`GeminiClientService`), which adapts the library to our
`IGeminiClientService` / `IGeminiClientQueryService` contracts.

Upstream published the 2.x rewrite on 2026-06-23 (`2.1.0` is latest; no
releases/tags/changelog in the repo — 18 stars, low maintenance). This design
is grounded in a **diff of the published npm tarballs** (`1.0.12` vs `2.1.0`,
source + `index.d.ts`), not upstream docs, which are stale.

Verified 1.0.12 → 2.1.0 API mapping (all consumed surface changes):

| We call (1.0.12) | 2.1.0 equivalent | Notes |
| --- | --- | --- |
| `GeminiClient` class | `Gemini` | Old name gone; Bun throws import-time `SyntaxError` on the named import (statically analyzable CJS exports) |
| `new GeminiClient({ secure_1psid, secure_1psidts })` | `new Gemini({ secure_1psid, timeout, autoClose, ... })` | `secure_1psidts`/`cookies` options removed; `client.cookies` is a public mutable dict |
| `init({ timeout, autoClose, autoRefresh, refreshInterval })` | `init()` (no args) | Tuning moved to constructor; `autoRefresh`/`refreshInterval` deleted upstream (no more cookie rotation; passive `set-cookie` merge per response instead) |
| `listChats(): ChatInfo[] \| null` (sync) | `chats(): Promise<unknown[]>` | Items are plain `{ cid, title, pinned, timestamp }` — **`is_pinned` renamed to `pinned`**; timestamp still seconds |
| `readChat(cid)` → `ChatHistory { turns: ChatTurn[] }` | `readChat(cid)` → `[{ role: string, text, thoughts?, images?, videos?, media? }]` | Plain array; empty = `[]` not `null`; `role` widened to `string`; default limit still 10 |
| `startChat({ cid })` | `newChat()` then `session.cid = cid` | `newChat({ model, temporary, gem })` has no `cid`; setter seeds `_meta[0]`, identical to v1 metadata seeding (verified in `src/chat.js` + `_stream` using `chat.metadata`) |
| `session.sendMessage({ prompt })` | `session.generateContent({ prompt })` | `ModelOutput.text` getter intact |
| `listModels(): AvailableModel[] \| null` (sync, account-probed registry) | `models(): Promise<AvailableModel[]>` | **Static catalog** of 10 Gemini 3 entries synthesized from the `Model` enum |
| `deleteChat(cid)` | `deleteChat(cid)` | Unchanged |
| `TimeoutError` | — removed — | Timeouts surface as raw axios `ECONNABORTED` errors or `APIError('Response stalled (zombie stream)')` / `APIError('Polling timed out.')` / `GeminiError('Connection lost. Recovery timed out.')` |
| `AuthError`, `APIError`, `GeminiError`, `UsageLimitExceeded`, `ModelInvalid`, `TemporarilyBlocked` | same names, same hierarchy | Unchanged |

New in 2.1.0 that we do **not** adopt: guest mode (cookie-less),
`generateContentStream`, generated images/videos/media on turns,
`ModelOutput.saveAll()`, `research()`, gems API, built-in retries (5×
generation, 2× batch RPC) — the retry/watchdog internals benefit us
transparently with no code on our side.

## Goals / Non-Goals

**Goals:**

- Run on `gemini-reverse@2.1.0` with `GeminiClientService`'s public contract
  (signatures, domain types, error types/messages) bit-identical.
- Land a package-surface contract test **before** the bump (Phase 0) so future
  upstream renames fail CI, not users.
- Eliminate the three identified silent regressions via targeted tests:
  `pinned` → `isPinned` mapping, timeout-message translation, `models()`
  display mapping.
- Preserve the 657-pass test baseline, clean typecheck, and clean mediation
  lint.

**Non-Goals:**

- No adoption of 2.1.0's new features (guest mode, streaming, media, deep
  research, gems).
- No persisting of refreshed cookies to disk (follow-up change
  `persist-refreshed-cookies`).
- No changes outside the wrapper + its two test files + one new smoke test +
  `package.json`/`bun.lock`/`CHANGELOG.md`.

## Decisions

### D1 — Pin `2.1.0` exactly (no semver range)

Upstream broke the public API in a 1.x minor (1.1.x) and ships no tests or
changelog. `~2.1.0` (patch-only) and `^2.1.0` both trust a maintainer who has
earned none. Exact pin + the Phase 0 contract test makes every future upgrade
a deliberate, reviewed act — same posture as this change.

### D2 — `models()` display mapping: prefer `model_name` over `display_name`

v1's account-probed registry had real display names ("Gemini 2.5 Flash"), so
the wrapper prefers `display_name`. v2's static catalog synthesizes
`display_name` as a **tier label** ("Basic Pro", "Plus Flash") while
`model_name` carries the real identifier (`gemini-3-pro`). Change the fallback
chain to `model_name || display_name || model_id`. Alternative considered:
keep `display_name`-first (minimal diff) — rejected, "Basic Pro" is
near-contentless in `gemiterm models` output. Output content changes either
way (the underlying list is new); this picks the informative variant.

### D3 — Construction & init mapping

```ts
this.client = new Gemini({ secure_1psid: config.secure1psid, timeout: 300_000, autoClose: false });
if (config.secure1psidts) this.client.cookies["__Secure-1PSIDTS"] = config.secure1psidts;
```

`timeout`/`autoClose` move from `init()` options to the constructor with their
current values. `autoRefresh`/`refreshInterval` are dropped — gone upstream,
and we had them disabled anyway; v2's passive `set-cookie` merging is
strictly better than our v1 behavior (no refresh at all). `verbose` /
`watchdogTimeout` keep upstream defaults. Our own init-idempotency guard
stays (it backs `isAuthenticated()`), even though v2's `_ensure()` is also
idempotent.

### D4 — Resume-chat: `newChat()` + `session.cid = cid`

Verified equivalent to v1's `startChat({ cid })`: the v2 `ChatSession` `cid`
setter writes `_meta[0]`, and `_stream` sends `chat.metadata` as the
conversation descriptor — the same slot v1 seeded from `StartChatOptions.cid`.
`sendMessage` / `startNewChat` map to
`session.generateContent({ prompt })`; the new conversation id still comes
from `session.cid` after the first response.

### D5 — `chats()` row mapping

Upstream types the result `unknown[]`; define a local
`interface RawChatRow { cid: string; title: string; pinned: boolean; timestamp: number }`
in the wrapper and map `pinned` → `isPinned` (seconds → milliseconds as
today). No defensive `is_pinned` fallback — the rebuilt mock mirrors the real
2.1.0 payload and cites the upstream source line, so drift fails tests
loudly rather than being silently absorbed.

### D6 — `readChat()` turn mapping

Map the returned array directly (no `.turns`); treat falsy/empty as `[]`.
Narrow the widened `role: string` with
`turn.role === "model" ? "model" : "user"` to satisfy our
`Message["role"]` union. `thoughts`/media fields on model turns are ignored,
matching today's text-only flattening.

### D7 — Error translation without `TimeoutError`

Drop the `TimeoutError` import/branch. Before the generic
`APIError`/`GeminiError` passthrough, add: if `(e as { code?: string }).code === "ECONNABORTED"`
**or** `e instanceof (APIError|GeminiError)` with message matching
`/\b(timed out|timeout|stalled)\b/i`, return
`new GeminiAPIError("Request to Gemini timed out")`. This preserves the exact
user-facing timeout message for all four v2 timeout shapes (axios abort,
zombie-stream watchdog, polling timeout, recovery timeout). `AuthError`,
`UsageLimitExceeded`, `ModelInvalid`, `TemporarilyBlocked` branches unchanged.

### D8 — Phase 0 safety net (lands on 1.0.12, must pass pre-bump)

New `tests/smoke/gemini-reverse-contract.test.ts` (no network, no mocks):

1. **Surface contract** — real `import("gemini-reverse")`; assert each export
   we consume exists with the right kind: client class is a constructible
   function; error classes are functions extending `Error`; required
   prototype methods present (`init`, `close`, chat list/read/delete, chat
   start, model list). Written against **1.0.12 names** now; the upgrade
   commit flips the expected names to the 2.1.0 set (and asserts
   `GeminiClient` is absent). Any future upstream rename/removal = red CI.
2. **Constructor contract** — construct the real client with
   `{ secure_1psid: "dummy" }` (no `init()` → no network) and assert
   `instance.cookies["__Secure-1PSID"] === "dummy"`. Passes on both versions
   unchanged.

## Risks / Trade-offs

- **[Upstream breaks again in a future release]** → Exact pin (D1) + contract
  smoke test (D8) + the verified mapping table above as the upgrade playbook.
- **[`pinned` field silently drifts again]** → Rebuilt wrapper mock mirrors
  the real 2.1.0 payload shapes with source-line citations; explicit
  `pinned` → `isPinned` mapping test; manual checklist verifies the pinned
  marker in `list`/`list -i` output. (No automated live-shape test is
  possible without credentials — accepted.)
- **[`models()` static catalog diverges from account reality]** → Accepted
  upstream trade-off; D2 keeps output informative; manual checklist item.
- **[Axios error internals change under us]** → Translation keyed on the
  documented `ECONNABORTED` code + message regex; covered by fixture tests
  (G4 in tasks).
- **[Bun CJS named-export interop regression]** → 2.1.0's `index.js` is a
  statically analyzable `module.exports = { ... }` literal; the import smoke
  test runs the real import in CI on every PR.
- **[2.1.0 misbehaves against the live web app]** → Rollback = revert the
  single upgrade commit and `bun install` (pin returns to `~1.0.12`, wrapper
  returns with it). No data or config migration involved.

## Migration Plan

1. **Phase 0 (separate commit, on `~1.0.12`):** add
   `tests/smoke/gemini-reverse-contract.test.ts` per D8. Full suite green.
2. **Phase 1 (single upgrade commit):** `package.json` pin → `2.1.0`,
   `bun install`; rewrite wrapper internals (D2–D7); flip contract test to
   2.1.0 names; update `tests/smoke/gemini-reverse-import.test.ts`; rebuild
   `tests/services/gemini-client-wrapper.test.ts` mock to 2.1.0 shapes + add
   `pinned`/timeout/models-mapping cases.
3. **Verify:** `bun test` (baseline intact), `bun run typecheck`,
   `bun run lint:mediation`, `bun run build`.
4. **Manual live checklist** (real account; no automated live tests by
   design): `auth`, `list` (pinned marker intact), `list -i`, `fetch`,
   `send`, `new`, `continue`, `models`, `delete`, `status`,
   `list --profile <alt>` multi-profile scoping.
5. **CHANGELOG.md** entry under a new patch/minor version crediting issue #5
   context and noting the `models` output change.

## Open Questions

None blocking. (Cookie-persistence design lives in the follow-up change
`persist-refreshed-cookies`.)
