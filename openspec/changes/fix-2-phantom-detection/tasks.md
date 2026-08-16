# Tasks: fix-2-phantom-detection

Baseline (fix-1 post-landing, recorded in its archived tasks): 865 pass / 2 skip / 0 fail / 1824 expects / 60 files. Run `bun run typecheck` after each group; conventional commits; never push.

## 1. List reactive phantom detection

- [ ] 1.1 In the single-profile list path (`src/cli/commands/list-command.ts` / `src/cli/utils/gemini-queries.ts`), after `listChats` resolves zero conversations, invoke `CookieSession.probe(profile)`; branch on `live` (normal empty output, no further action), `phantom`/`dead` (recovery offer path); multi-profile queries skip classification entirely
- [ ] 1.2 TTY branch: confirm prompt via the `src/cli/utils/prompts.ts` facade (respect `CancellationError` - decline leaves the empty output); on accept, run the fix-1 recovery rung (failures surface the typed `AuthenticationError`, which feeds the existing headed re-login prompt contract) and retry the list query exactly once; still-empty retry prints the phantom diagnostic
- [ ] 1.3 Non-TTY branch: stderr diagnostic line (profile name + state + `gemiterm auth` hint); stdout output unchanged
- [ ] 1.4 RED-first tests: phantom single-profile result triggers exactly one probe + (TTY) one recovery + one retry; `live` empty result triggers one probe and no recovery; multi-profile queries trigger zero probes; non-TTY stdout bytes unchanged (extend `tests/integration/commands/list.test.ts` fixtures)

## 2. Status --verbose probe column

- [ ] 2.1 Add `--verbose` flag to `status`'s arg spec (usage text updated; no other flags affected)
- [ ] 2.2 When set, probe each profile sequentially via `CookieSession.probe` and render a PROBE column with `live (N)` / `phantom` / `dead`; without the flag, output is byte-identical to today
- [ ] 2.3 RED-first tests: `--verbose` renders the column from fake classifier states; default invocation performs zero probes and output is unchanged

## 3. Verification

- [ ] 3.1 Full suite green; net test count recorded here; `bun run typecheck` clean; `bun run lint:mediation` clean
- [ ] 3.2 `tests/integration/commands/list.test.ts` byte-equivalence green
- [ ] 3.3 Live verification (user-assisted): idle a profile past the ~1 h phantom window (real idling only — backdating the jar mtime merely triggers the stale-spawn path; the cookie values stay server-valid so the classifier reports `live` and no phantom state is reproduced); `gemiterm status --verbose` shows `phantom` (or `dead`); `gemiterm list` either self-heals via the recovery offer or prints the phantom diagnostic - never a bare `No conversations found.`; cross-check `<configDir>/gemiterm.log` shows the detached rotation around the same window (separates engine failure from account state when triaging)
