# Design — fix-6-classifier-token-extraction

## Context

`SessionClassifier.classifyDetailed` (`src/auth/session-classifier.ts:56-74`) fetches the init HTML and decides token presence with `INIT_TOKENS.some((t) => html.includes(t))` where `INIT_TOKENS = ["SNlM0e", "cfb2h", "FdrFJe"]` (`src/auth/auth-constants.ts:16`). Substring match on the *key*. Gemini serves signed-out pages that still embed the keys with empty values (`"cfb2h":""`), so the check passes and the classifier proceeds to the chats probe — which can succeed through the SDK's any-name cookie fallback, producing a bogus `live`. The ablation harness (docs/cookie-ablation-findings.md, Method) already solved this: extract values with `/"SNlM0e":\s*"(.*?)"/`-class regexes; all-empty ⇒ DEAD. The classifier predates that harness and was never aligned.

Constraint: the classifier is the only sanctioned session-state oracle (`openspec/specs/auth/spec.md:190`) and is invoked read-only by `status`, `activeProfiles`, and conversation routing — the change must stay side-effect-free and not grow a network call.

## Goals / Non-Goals

**Goals**
- `dead` verdict requires only honest evidence: a non-empty extracted value for at least one required init token.
- One extraction implementation, shared shape with the ablation §6.2 regexes, so a future consumer (e.g. gated saves) reuses it.

**Non-Goals**
- Changing `live` vs `phantom` semantics (chats ≥ 1 vs 0) — untouched.
- Changing capture, validation, or rotation — fix-7/fix-8 territory.
- Extracting token values *for use* (e.g. feeding `SNlM0e` to RPCs) — only presence/absence matters here.

## Decisions

1. **Value-extraction predicate, any-token sufficiency.** Extract each required token's value with its regex; tokens-present iff ≥ 1 of `SNlM0e` / `cfb2h` / `FdrFJe` yields a non-empty value; otherwise `dead`. Rationale: matches the ablation's DEAD-INIT verdict rule ("all-null ⇒ signed out ⇒ DEAD") and stays robust to Google adding/removing one key. Alternative considered — require *all three* non-empty (stricter, but the ablation never validated all-three-ness; a single held-back key would misclassify live sessions as dead, the more damaging direction).
2. **Extraction table lives in `auth-constants.ts`** as `INIT_TOKEN_EXTRACTION: { token: string; pattern: RegExp }[]`, replacing `INIT_TOKENS`. Rationale: constants module already owns the token names; the classifier stays logic-only. `INIT_TOKENS` is deleted, not kept beside the table — no other consumer exists (grep-verified: `session-classifier.ts` only).
3. **Regexes anchored exactly as the ablation §6.2**: `/"SNlM0e":\s*"(.*?)"/` etc. Rationale: byte-matching the validated harness avoids re-deriving escape/whitespace behavior (`"KEY": "value"` with optional space is covered by `\s*`).

## Risks / Trade-offs

- [Signed-out HTML stops matching ⇒ profiles previously misread `live` now read `dead`/`phantom`, visibly changing `status` output for broken jars] → that is the fix; note it in the docs changelog so field reports aren't treated as regressions.
- [Google changes serialization so regexes miss (e.g. escaped quotes)] → same failure mode the validated harness would have; re-run the ablation probe before changing the pattern.

## Migration Plan

Single PR: table + classifier swap + tests. Rollback = revert; no persisted-state migration.

## Open Questions

(none — predicate settled by the ablation; sequencing settled: this change lands before fix-7/fix-8.)
