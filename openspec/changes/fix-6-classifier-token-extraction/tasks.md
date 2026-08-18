## 1. Regression harness (red first)

- [ ] 1.1 Add `tests/auth-regression/invariant-classifier-token-values.test.ts`: fixture init HTML with token keys present but empty values (e.g. `"cfb2h":""`) → classifier MUST resolve `dead`; fixture with one non-empty extracted value → proceeds to chats probe. Watch it fail against `html.includes`.

## 2. Implementation

- [ ] 2.1 Replace `INIT_TOKENS` in `src/auth/auth-constants.ts` with `INIT_TOKEN_EXTRACTION` (`SNlM0e`, `cfb2h`, `FdrFJe`, pattern `/"<token>":\s*"(.*?)"/` per ablation §6.2); delete `INIT_TOKENS` (no other consumers).
- [ ] 2.2 Rewrite the token check in `src/auth/session-classifier.ts:67` to extraction-based presence (≥ 1 non-empty value ⇒ present; else `dead`).
- [ ] 2.3 Update existing classifier unit tests from name-presence fixtures to value fixtures (empty-value keys ⇒ dead; non-empty ⇒ live/phantom split unchanged).

## 3. Gates + docs

- [ ] 3.1 Run `bun test --isolate` (record pass/fail count in tasks.md if it moves), `bun run typecheck`, `bun run lint:mediation`, `bun run check:auth-gate` (change touches `src/auth/` and `tests/auth-regression/` — gate must pass).
- [ ] 3.2 Append the `docs/auth-cookie-lifecycle.md` changelog entry (value-extraction classifier; note that previously misread-as-live broken jars will now report phantom/dead — visible `status` behavior change).
