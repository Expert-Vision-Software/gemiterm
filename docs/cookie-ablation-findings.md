# Cookie Ablation Findings — gemini.google.com (2026-08-15)

First-principles empirical study of Gemini web auth-cookie requirements and session decay, methodology mirrored from `teng-lin/notebooklm-py` `docs/auth-cookie-lifecycle.md` §3.3. This doc supersedes every cookie-requirement hypothesis in `docs/phantom-bug-synthesis.md` (which observed broken code observing broken jars).

## Method

- **Zero gemiterm auth code used.** All probes are raw `fetch` against Google, replicating the `gemini-web-sdk@2.2.0` transport wire (verified by live probing, not by trusting the SDK): init `GET https://gemini.google.com/app` + regex token extraction; listChats `POST …/batchexecute?rpcids=MaZiqc` (triple-nested `f.req`, `x-goog-ext-*` headers); RotateCookies wire byte-matched to notebooklm-py `_auth/mint_service.py` (only `Content-Type: application/json` + `Origin: https://accounts.google.com`, per-hop Set-Cookie capture).
- Cookie selection implements RFC 6265 domain/path/expiry rules independently; jars are in-memory only; nothing persisted during probing; no cookie values logged.
- Outcome classes: `OK` (init tokens + listChats ≥1) · `PHANTOM` (init tokens + listChats 0) · `DEAD-INIT` (200 HTML, no tokens) · `RPC-ERR` (non-200).
- Environment: account `dhb-zeek` (personal, non-Workspace), residential IP, Windows/Bun, 2026-08-15 ~09:15–13:30Z. Harness (throwaway, gitignored): `.gemiterm/harness/`.

## Verdict tables

### Prototype 1 — full-jar ablation (fresh session, 31 variants, 4 s pacing)

| Variant | Result |
|---|---|
| baseline (41 cookies) | OK · 14 chats |
| drop-1 × 22 (every auth cookie incl. `SID`, `__Secure-1PSID`, all companions, PSIDRTS, PAPISID, GAPS, OTZ) | **OK · 14 chats — every one** |
| drop-1 `__Secure-1PSIDTS` | **DEAD-INIT** (200, no tokens, no redirect) |
| drop-2 PSIDTS+SID / PSIDTS+APISID | DEAD-INIT |
| drop-2 SID+APISID · drop-3 APISID+SAPISID+LSID | OK · 14 chats |
| sdk-minimal (`__Secure-1PSID`+`__Secure-1PSIDTS` only) | OK · 14 chats |
| trimmed-4-cookie jar (the historical "bug jar": PSID+PSIDTS on .google.com/.youtube.com) | **OK · 14 chats** |
| RotateCookies on fresh session (headers imperfect, single-hop capture) | 200, `hfcr=600`, no PSIDTS observed |

### Prototype 2 — dormancy, rotate-recovery, L3, stress (3× reps)

**Dormancy observation** (the phantom bug, captured live): after **9.1 h** idle with zero rotation, the jar was byte-unchanged on disk and the session probed **DEAD-INIT** — Google serves 200 signed-out HTML without redirect. The historical "phantom" state (init ✓, listChats 0, ~1–2 h idle) is an *earlier stage of the same decay* — the RPC layer loses authorization before the init surface stops issuing tokens.

**L1 RotateCookies on the dead session** (exact notebooklm wire, ×2 variants 65 s apart):

| Attempt | Result |
|---|---|
| B1: stale jar incl. stale PSIDTS | 200 · `hfcr=600` · minted `NID`,`SIDCC`,`__Secure-1/3PSIDCC` · **PSIDTS withheld** · init still dead |
| B2: PSIDTS stripped (sentinel semantics) | 200 · `hfcr=600` · `di` counter incremented 14→15 · **PSIDTS withheld** · init still dead |

**L3 browser-backed recovery** (persistent Chromium profile at `profiles/dhb-zeek/`, headless page load, `state-save`):

| Step | Result |
|---|---|
| Page load `gemini.google.com/app` | Signed in; page JS rotated PSIDTS to a **new value** |
| Raw probe of captured jar | **LIVE · 14 chats** |
| gemiterm CLI on restored jar | 14 chats |

**L1 RotateCookies on the LIVE (L3-recovered) session**: 200 · `hfcr=600` · SIDCC family minted · **PSIDTS still not minted** · session unharmed (post-rotate probe OK · 14).

**Stress matrix (3 reps, deterministic 3/3 each)**:

| Variant | rep1/rep2/rep3 |
|---|---|
| baseline | OK · OK · OK |
| drop `SID` | **OK · OK · OK** |
| drop `__Secure-1PSIDTS` | **DEAD-INIT × 3** |
| drop `__Secure-1PSID` | **OK · OK · OK** |
| drop `APISID`+`SAPISID` | OK · OK · OK |
| drop `APISID`+`SAPISID`+`LSID` | OK · OK · OK |
| sdk-minimal (PSID+PSIDTS) | OK · OK · OK |

## Proven claims

1. **`__Secure-1PSIDTS` is the only individually-required cookie** for Gemini's init GET + listChats RPC on this account. Everything else — PSID and SID included — is individually droppable with full function (Google re-issues mid-call).
2. **The trimmed 4-cookie jar was never broken by shape.** The "companions required for listChats" hypothesis from the ledger is dead: dropping the entire companion set still lists 14 chats.
3. **The phantom/dormancy bug is server-side PSIDTS supersession, not capture width.** Same cookie *names* with a fresh PSIDTS *value* → live; byte-stale jar → DEAD-INIT. Nothing client-side detects this in advance (local `expires` is meaningless — matches notebooklm §2.5).
4. **L1 HTTP rotation cannot revive a decayed session** — Google withholds PSIDTS re-mint once the session has decayed (200 + SIDCC rotation + no PSIDTS = notebooklm's documented "silent failure" canary).
5. **L1 HTTP rotation did not mint PSIDTS even on a live session for this account** (4 attempts total: fresh, stale, sentinel, live). The unsigned endpoint still functions (SIDCC rotation, `hfcr=600`, harmless). Possible DBSC-transition effect — notebooklm's own canary table flags "Gemini-API's bare-sentinel rotation reported decaying under DBSC" as the upstream warning for exactly this primitive.
6. **Browser-backed rotation is the proven PSIDTS-rotation mechanism**: a page load on the persistent profile rotated PSIDTS and fully resurrected a 9-hour-dead session. This is L3 (notebooklm taxonomy) functioning as the primary refresh engine.

## Answers to the four challenges (2026-08-15 session)

1. **"How do you know SID isn't tier-1 here?"** — drop-SID probed OK 3/3 (deterministic), plus OK in prototype 1, via raw wire (not our code). notebooklm's SID rule governs *their* homepage GET on `notebooklm.google.com`; Gemini's surfaces accept SID-less requests. Both findings can be true — different app, different accept-rule. Their own caveat applies symmetrically: model fit, not server mechanism.
2. **"Harm in keeping companions?"** — None. We keep the full jar (settled: full-jar capture + domain filter). The ablation informs *validation gating* (what must exist = PSIDTS), never *capture policy*. notebooklm names partial extraction the #1 cause of "auth expires immediately"; un-ablated surfaces (StreamGenerate/readChat) may still want companions.
3. *(no item 3)*
4. **"If 2 cookies suffice, why did the dormant profile fail?"** — because sufficiency is about *shape*, the failure is about *freshness*. The dormant profile's PSIDTS was superseded server-side after hours of zero rotation; the identical shape with a fresh PSIDTS (post-L3) works. Current v2.4.0-lineage code never rotates PSIDTS, and passive SDK Set-Cookie merging can't fire when no requests succeed — hence irreversible decay until browser re-auth.

## Design implications (for the CookieSession replacement)

- Tier-1 validation for Gemini = **`__Secure-1PSIDTS` routable** (+ `__Secure-1PSID` present as practical identity anchor, warn-tier). Tier-2 = warn on missing companion set (un-ablated surfaces; defense in depth). Capture = full jar, domain-filtered — unchanged.
- **Browser-backed refresh (persistent profile + page load + state-save) is the primary rotation engine** for this account today; unsigned RotateCookies is a cheap, harmless, best-effort supplement (SIDCC refresh, `hfcr` readout) — do not rely on it for PSIDTS.
- The L3 recovery path (dead → browser page-load → live) is validated end-to-end, including restoring a real profile.
- Phantom detection: reactive response-layer check (init-tokens ✓ + listChats 0 ⇒ phantom; tokens ✗ ⇒ dead) is the honest classifier; nothing local predicts decay.

## Limitations

- Single account, non-Workspace, residential IP, one day. notebooklm replicated across two accounts; a second fresh profile would replicate the matrix cross-account (offered, not yet required for design decisions).
- Only init + `MaZiqc` (listChats) ablated. `StreamGenerate` (send), `hNvQHb` (readChat) not ablated — companions may matter there.
- RotateCookies PSIDTS-withholding may be time/account-varying (DBSC rollout); re-verify periodically.

## Artifacts

- `.gemiterm/harness/` (gitignored, throwaway): `ablation.ts`, `state-probe.ts`, `prototype2-recovery.ts`, `prototype2-stress.ts`, `debug-rpc.ts`, `probe-l3.ts`, `ablation-log.jsonl`, `prototype2-log.jsonl`, `baseline-full.json`, `l3-recovered.json`, `variant-4cookie-original.json`.
- `docs/PLAYWRIGHT_CLI_API.md` — the L3 flow used (`open --persistent --profile`, `state-save`, `close`).
