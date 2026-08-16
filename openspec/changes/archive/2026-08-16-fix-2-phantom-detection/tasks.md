# Tasks: fix-2-phantom-detection

Baseline (fix-1 post-landing, recorded in its archived tasks): 865 pass / 2 skip / 0 fail / 1824 expects / 60 files. Post-implementation (2026-08-16): 889 pass / 2 skip / 0 fail / 1903 expects / 60 files. Run `bun run typecheck` after each group; conventional commits; never push.

## 1. List reactive phantom detection

- [x] 1.1 In the single-profile list path (`src/cli/commands/list-command.ts` / `src/cli/utils/gemini-queries.ts`), after `listChats` resolves zero conversations, invoke `CookieSession.probe(profile)`; branch on `live` (normal empty output, no further action), `phantom`/`dead` (recovery offer path); multi-profile queries skip classification entirely
- [x] 1.2 TTY branch: confirm prompt via the `src/cli/utils/prompts.ts` facade (respect `CancellationError` - decline leaves the empty output); on accept, run the fix-1 recovery rung (failures surface the typed `AuthenticationError`, which feeds the existing headed re-login prompt contract) and retry the list query exactly once; still-empty retry prints the phantom diagnostic
- [x] 1.3 Non-TTY branch: stderr diagnostic line (profile name + state + `gemiterm auth` hint); stdout output unchanged
- [x] 1.4 RED-first tests: phantom single-profile result triggers exactly one probe + (TTY) one recovery + one retry; `live` empty result triggers one probe and no recovery; multi-profile queries trigger zero probes; non-TTY stdout bytes unchanged (extend `tests/integration/commands/list.test.ts` fixtures)

## 2. Status --verbose probe column

- [x] 2.1 Add `--verbose` flag to `status`'s arg spec (usage text updated; no other flags affected)
- [x] 2.2 When set, probe each profile sequentially via `CookieSession.probe` and render a PROBE column with `live (N)` / `phantom` / `dead`; without the flag, output is byte-identical to today
- [x] 2.3 RED-first tests: `--verbose` renders the column from fake classifier states; default invocation performs zero probes and output is unchanged

## 3. Verification

- [x] 3.1 Full suite green; net test count recorded here; `bun run typecheck` clean; `bun run lint:mediation` clean
- [x] 3.2 `tests/integration/commands/list.test.ts` byte-equivalence green
- [x] 3.3 Live verification (user-assisted): first attempt 2026-08-16 (gemiterm2 checkout) — idled 1.5 h past the stale window and ran `list`; it succeeded (no phantom empty result — the session had not yet decayed server-side). Verified live: the post-idle run armed both stale jars (`dhb-zeek`, `dhb-worker`) and the detached runners rotated `__Secure-1PSIDTS` (~12-15 s) with both `rotated=true` in `<configDir>/gemiterm.log`, separating engine health from account state. Not yet reproduced: an actual `phantom`/`dead` classification (`status --verbose` showed `live`). The phantom state requires real server-side supersession decay and remains reproducible only by idling a profile past the ~1 h phantom window — deferred as residual risk; the synthetic-seam tests (1.4, 2.3) pin the detection/recovery behavior regardless.

Note: the count-aware probe needed for `live (N)` landed as `CookieSession.probeDetailed` (classifier `classifyDetailed`); `probe`'s tri-state contract is unchanged. The classifier's probe wiring now calls the unbounded `listChats()` — network-identical to `listChats({limit:1})` (the SDK fetches the full list and slices client-side), so the chat count is real.
