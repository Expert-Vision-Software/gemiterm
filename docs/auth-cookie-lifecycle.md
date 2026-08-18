# Auth & cookie lifecycle — design notes and field findings

**Last Updated:** 2026-08-18

> **Status:** design notes and field findings for GemiTerm's auth stack, and the
> design target for the planned `CookieSession` deep-module replacement (see
> [§11](#11--relationship-to-current-code--openspec)). The empirical sections
> (§2.6, §3.3, §4.3, §5, §6) are **[VALIDATED]** by the 2026-08-15 ablation
> study — raw-wire probing with zero gemiterm auth code, 3× deterministic
> replication ([docs/cookie-ablation-findings.md](cookie-ablation-findings.md)).
> Everything else is design intent; every ladder rung and mechanism is marked
> **[CURRENT]** / **[PLANNED]** / **[FUTURE]**. Structurally modeled on
> [teng-lin/notebooklm-py — auth-cookie-lifecycle.md](https://github.com/teng-lin/notebooklm-py/blob/main/docs/auth-cookie-lifecycle.md);
> notebooklm facts are cited as theirs, not ours.
>
> Companion documents:
> [docs/cookie-ablation-findings.md](cookie-ablation-findings.md) — the empirical
> study this doc embeds and must not contradict;
> [docs/archive/phantom-bug-synthesis.md](archive/phantom-bug-synthesis.md) — the write-once bug
> ledger (condensed into [Appendix A1](#a1--bug-history-the-phantom-saga-v240--v27x));
> [docs/PLAYWRIGHT_CLI_API.md](PLAYWRIGHT_CLI_API.md) — browser command
> reference for the L3 flow.

## TL;DR

Gemini's web app has no public OAuth surface for what GemiTerm does. The CLI
authenticates by carrying Google session cookies (`SID`, `__Secure-1PSID`,
`__Secure-1PSIDTS`, and ~37 friends in a live jar) obtained from a real browser
sign-in on a persistent Chromium profile, replayed through
`gemini-web-sdk@2.2.0` (axios). Two clocks govern validity:

- **`__Secure-1PSIDTS` has a recommended rotation cadence of ~600 s**
  (self-reported by Google as `["identity.hfcr",600]` in the `RotateCookies`
  response). That is a hint, not a hard TTL — but once a newer value has been
  issued elsewhere (or the session simply idles past the server's patience),
  the **superseded** value is rejected. The cookie's local `expires` attribute
  (365 days out) is meaningless: a jar that looks a year fresh can already be
  dead.
- **`SID` / `__Secure-1PSID` and the rest of the `*SID` family** have long
  server-side lifetimes (months) and are not the failure point.

**The phantom-auth bug that GemiTerm has carried since v2.4.0 is this decay,
not a capture defect.** Sessions idle for ~1–2 h decay into PHANTOM (init
works, `listChats` returns 0), later into DEAD (init serves signed-out HTML).
Root cause proven 2026-08-15: **server-side `__Secure-1PSIDTS` supersession
under zero rotation.** The historical trimmed 4-cookie jar — long blamed —
works fine when fresh. The ablation also proved, on this account:

1. **`__Secure-1PSIDTS` is the only individually-required cookie** for the init
   GET and the `MaZiqc` listChats RPC. Dropping any other single cookie (22
   drop-1 variants, including `SID` and `__Secure-1PSID`) leaves full function.
2. **HTTP `RotateCookies` never mints `__Secure-1PSIDTS` on our account**
   (4/4 attempts: fresh, stale, sentinel-stripped, live). The endpoint works
   (200, `hfcr=600`, SIDCC-family minted) but withholds the one cookie that
   matters. Matches notebooklm's "silent failure" canary.
3. **A page load on the persistent Chromium profile rotates PSIDTS via
   Google's own page JS and resurrected a 9-hour DEAD session** — validated
   end-to-end. Browser-backed refresh (L3) is the primary engine; HTTP
   rotation (L1) is a cheap, harmless supplement.

The recovery ladder runs cheapest-to-heaviest — L1 HTTP `RotateCookies` POST
**[PLANNED]**, L2 background keepalive **[PLANNED]**, L3 browser-backed refresh
**[VALIDATED, primary]**, L4 master-token re-mint **[FUTURE]**, L5
`GEMITERM_REFRESH_CMD` external hook **[PLANNED]**, L6 manual `gemiterm login`
**[CURRENT]**, L7 OS-scheduled refresh **[PLANNED]** (detail in
[§4](#4--the-recovery-ladder)). Validation is two-tier: `__Secure-1PSIDTS`
present **and routable** plus `__Secure-1PSID` present (raise/warn), companion
set (warn only); capture is always the full jar — capture policy is never
informed by the ablation.

---

## Available auth methods

The ways a GemiTerm profile can hold credentials, by deployment shape:

| Method | Command / env | Status | Best for | Survives cookie expiry unattended? | Setup cost |
|---|---|---|---|---|---|
| **(a) Interactive login** | `gemiterm login` / `gemiterm auth` (headed Playwright Google sign-in into the profile's persistent Chromium user-data dir) | **[CURRENT]** | Desktop / interactive use | No — decay arrives in hours; L3 recovery is the planned remedy | Low (one browser sign-in) |
| **(b) Browser-cookie reuse** | none today | Not built; Chrome path ruled out ([A3](#a3--ruled-out-experiments)) | Reusing a browser you already sign into | Only while the source session stays alive | Low if ever built (Firefox only) |
| **(c) Master token** | `gemiterm login --master-token` (L4) | **[FUTURE]** | Servers / CI / unattended | **Yes** — re-mints web cookies, no browser, survives password changes | Medium (one bootstrap sign-in; ship `master_token.json`) |
| **(d) External refresh hook** | `GEMITERM_REFRESH_CMD=<command>` (L5) | **[PLANNED]** | Custom recovery (CookieCloud pull, browser re-extract) layered on any of the above | Depends on the script | Medium (write + secure a script) |
| **(e) Scheduled refresh** | `gemiterm auth refresh` via Task Scheduler / systemd / cron (L7) | **[PLANNED]** | Idle profiles between CLI runs | Prevents decay rather than reviving | Low (one schedule entry) |

Note (c) is the eventual recommended default for long-lived headless use — the
only method that survives full cookie expiry with no browser at refresh time.
It is deliberately **out of scope for v1** of the auth replacement
([§11](#11--relationship-to-current-code--openspec)) but fully specified in
[§4.4](#44-l4--master-token-re-mint-future) so a future agent can build it
without re-deriving the design.

## Recommended setup

### Interactive desktop user

Just `gemiterm login`. The headed Playwright flow handles sign-in on the
persistent profile. Sessions still decay after hours idle; the planned design
recovers them automatically via L3 (phantom detected → page load → gated save)
instead of prompting for re-auth.

### Automation against a workstation profile

Schedule L7 once it ships: `gemiterm auth refresh` every 15–20 min on an
off-minute (e.g. `7,27,47 * * * *`). Each run is one L3 page load plus a gated
save. Cheaper and more robust than a resident daemon.

### Headless server / CI (future)

Adopt L4 master token once built — see [§4.4](#44-l4--master-token-re-mint-future).
Until then, GemiTerm is not recommended for unattended servers: the only proven
refresh engine needs the persistent browser profile, and the only HTTP engine
withholds PSIDTS on the tested account.

---

## 1 · Problem statement

GemiTerm automates the Gemini web app through its internal `batchexecute` RPC
surface (`gemini-web-sdk@2.2.0`, axios transport). No API key, no OAuth scope,
no service-account path. Every project that automates gemini.google.com does
so with **scraped session cookies** from a logged-in browser.

Profiles live at `%APPDATA%\gemiterm\profiles\<name>\` (or
`GEMITERM_CONFIG_DIR\profiles\...` on override). Each profile dir is
**dual-state**:

- `storage_state.json` — the Playwright StorageState export the CLI loads into
  the SDK on every invocation;
- after a headed login, a **full Chromium user-data dir** (`Default/Network/Cookies`,
  `Local State`, caches) — the browser's own live database.

The dual state matters: the browser DB can hold a live session long after the
exported snapshot has decayed, because Google's page JavaScript keeps rotating
the DB's cookies whenever a page loads. That asymmetry is exactly what the L3
recovery engine exploits ([§4.3](#43-l3--browser-backed-refresh-from-the-persistent-profile-validated--primary-engine)).

The design question this doc answers: **what keeps the profile's session valid
between user-driven re-authentications, and how does the CLI detect and recover
decay?** The naïve "cookies have expiry timestamps; trust them" answer is wrong
twice over — the decisive cookie's server-side validity is not encoded in its
`Expires` attribute, and the current v2.x code never rotates `__Secure-1PSIDTS`
at all (the SDK's passive Set-Cookie merging cannot fire once requests start
failing). The observed consequence, since v2.4.0: sessions work at login,
return 0 chats after ~1–2 h idle (PHANTOM), and serve signed-out HTML by ~9 h
(DEAD).

---

## 2 · Background: Gemini web session auth, rotation, and DBSC

### 2.1 The cookie taxonomy (a 41-cookie live jar)

A logged-in Chromium profile on gemini.google.com carries ~41 cookies. Naming
conventions are Google-standard: `__Secure-` requires the `Secure` attribute;
`__Host-` additionally pins `Path=/` and exact-host (no `Domain=`); `1P`/`3P`
are first-party vs third-party context variants that rotate independently —
Gemini's jar carries both, on `.google.com` and `.youtube.com`.

Grouped by family:

| Family | Members (observed) | Role | Rotation / lifetime |
|---|---|---|---|
| `*SID` — identity | `SID`, `HSID`, `SSID`, `APISID`, `SAPISID` | Who you are; slow to change | Months → ~1 year |
| `*SIDTS` — freshness | `__Secure-1PSIDTS`, `__Secure-3PSIDTS` | "You are using the session right now" | **~600 s recommended cadence** (`identity.hfcr` self-report) |
| `*SIDCC` — continuity | `SIDCC`, `__Secure-1PSIDCC`, `__Secure-3PSIDCC` | Per-request session-continuity check | ~5 min sliding; **not load-bearing** (validated: droppable) |
| `*PSIDRTS` | `__Secure-1PSIDRTS`, `__Secure-3PSIDRTS` | **Gemini-specific; absent from notebooklm's taxonomy; purpose unverified** | Unknown |
| `*PAPISID` | `__Secure-1PAPISID`, `__Secure-3PAPISID` | Companion to APISID family | Unknown |
| Identity-service | `LSID`, `__Host-1PLSID`, `__Host-3PLSID`, `__Host-GAPS` | `accounts.google.com` cookies; `__Host-GAPS` is anti-takeover binding | Long-lived |
| Misc | `NID`, `OTZ`, `COMPASS`, `SMSV`, `ACCOUNT_CHOOSER`, `_ga*` | Ambient / analytics / chooser state | Varies |

**No `OSID` in Gemini's jar.** Notebooklm's tier-2 secondary binding anchors
on `OSID` (their §3.3); Gemini's equivalent branch, if any, runs through the
`APISID`+`SAPISID`+`LSID` triple — but note the ablation
([§3.3](#33-empirical-cookie-requirements-validated-2026-08-15)) found even
that triple is not required for the surfaces tested. Different app, different
accept-rule.

### 2.2 How rotation works (and why the SDK never does it)

"Rotation" means Google periodically issues a new `__Secure-1PSIDTS` value via
`Set-Cookie`, and the client is expected to overwrite its stored copy. If the
client falls behind, the server eventually stops accepting the old value: first
the RPC layer loses authorization (PHANTOM), then the init surface stops
issuing tokens (DEAD). Rotation is **server-driven** — the client only chooses
when to poke an identity-surface endpoint.

Three facts drive the whole design:

1. **Pure RPC traffic against `gemini.google.com` does not trigger rotation.**
   `batchexecute` accepts existing cookies but mints nothing. Google rotates
   `*PSIDTS` only when something talks to the identity surface:
   `accounts.google.com` (the `RotateCookies` POST), or the app homepage's own
   page JavaScript (a real page load). A client that only calls batchexecute
   silently drifts past the rotation window — exactly GemiTerm's failure mode.
2. **`gemini-web-sdk@2.2.0` does no rotation of any kind.** It constructs its
   client from ONLY `secure_1psid` + optional `secure_1psidts` (a 2-cookie
   wire surface) and passively merges `Set-Cookie` responses after each call.
   No companion cookies are ever sent by the SDK; nothing proactive exists.
   Passive merging cannot fire once requests start failing — decay is
   irreversible from inside the SDK.
3. **The browser DB keeps rotating after the export stops.** Any page load on
   the persistent profile runs Google's page JS, which rotates PSIDTS in the
   DB even when the exported `storage_state.json` is long dead. This is the L3
   primitive.

### 2.3 Device-Bound Session Credentials (DBSC)

DBSC is Google's counter to infostealer cookie theft: bind the session to a
non-extractable key in tamper-resistant hardware; the enforcing endpoint
(`accounts.google.com/RotateBoundCookies`) requires a signed server nonce per
rotation, so a stolen jar cannot renew itself. The [W3C
spec](https://w3c.github.io/webappsec-dbsc/) is built around browser+TPM
attestation — no HTTP client can implement it. Current enforcement targets
Chrome itself; the unsigned `RotateCookies` endpoint remains reachable, and
our field finding ([§5.3](#53-field-finding-psidts-withheld-44-attempts)) —
200 + SIDCC mint + PSIDTS withheld — matches notebooklm's canary for
DBSC-transition behavior on exactly this primitive. If enforcement extends
further, the escape is the L3 browser path (or its CDP-attach variant), which
runs Google's own JS in a real Chromium.

### 2.4 The dual-state profile

The persistence design must respect that the profile dir holds two sources of
truth: the exported `storage_state.json` (what the CLI loads) and the Chromium
user-data dir (what the browser maintains). They diverge by design — the DB is
fresher whenever any page has loaded since the last export. Rules:

- The exported snapshot is the CLI's credential; the DB is the recovery
  reservoir.
- Never write to the DB by hand; refresh it only by loading pages (Google's JS
  owns it).
- Export (L3's `state-save`) only from a confirmed-authed page state — see the
  anti-pattern in [§4.3](#43-l3--browser-backed-refresh-from-the-persistent-profile-validated--primary-engine).

### 2.5 Four timers people confuse

| Timer | Magnitude | Lives in | Meaning |
|---|---|---|---|
| `*PSIDTS` rotation cadence | ~600 s | Google's identity surface | Recommended active-client refresh interval, self-reported as `["identity.hfcr",600]` in the `RotateCookies` body. Re-measured 2026-08-15 on our account: still 600. |
| `*PSIDTS` supersede grace | **short, server-side, not ours to set** | Google's identity surface | How long a superseded value keeps working. Undocumented. The local `expires` attribute is meaningless — a 365-day-stamped PSIDTS can already be rejected. |
| `*SIDCC` sliding window | ~5 min | Google's RPC surface | Different family; rotates nearly every request; validated not load-bearing. |
| Client-side rotation throttle | 60 s | Planned L1 guard | Don't fire two `RotateCookies` POSTs within a minute (429 avoidance). Unrelated to how often Google requires rotation. **[PLANNED]** |

> **Supersede warning.** Any other active client on the same account — a
> browser tab left open, a second machine, a sibling CI job — supersedes your
> PSIDTS within ~10 minutes at the 600 s cadence; the grace period then
> decides how long your copy limps on. A cookie snapshot is not a durable
> credential, and no client-side signal predicts its death. Our own dormancy
> datapoint: a byte-unchanged jar probed DEAD after 9.1 h idle with zero
> rotation.

### 2.6 The session state model **[VALIDATED]**

| State | Init GET (`/app`) | listChats (`MaZiqc`) | Meaning |
|---|---|---|---|
| `LIVE` | tokens present | ≥ 1 chat | Healthy |
| `PHANTOM` | tokens present | 0 chats | Transient decay stage (~1–2 h idle observed historically; the RPC layer lost authorization before the init surface stopped issuing tokens). No local signal predicts it. |
| `DEAD` | 200 with signed-out HTML — **no `SNlM0e`/`cfb2h`/`FdrFJe`/`TuX5cc` tokens, and possibly no redirect at all** (Gemini serves 200, unlike the classic 302-to-signin) | RPC 401/403 class | Full server-side death |

Detection predicate **[PLANNED, response layer]**: after `listChats` returns
0, re-derive the init tokens — tokens present ⇒ phantom, tokens absent ⇒ dead.
The `gemiterm status` probe is the same classifier exposed read-only with no
side effects (mirror of notebooklm's `auth check --test --passive`). Reactive
only: nothing local predicts decay, so preemptive probing is wasted traffic
and — per the ledger — actively harmful when its verdict triggers destructive
recovery (A1, A2.3).

---

## 3 · Threat model

### 3.1 What kills a session in practice

In rough order of likelihood for GemiTerm:

1. **`*PSIDTS` supersession under zero rotation.** Nothing rotates the cookie;
   the server withdraws authorization (PHANTOM), then the session (DEAD).
   **The dominant failure mode — validated as the phantom-bug root cause.**
2. **Other-client supersession.** A browser tab on the same account rotates
   the session out from under the CLI within ~10 min.
3. **Risk-scored revalidation.** New IP, no fingerprint, odd cadence — forces
   full re-auth unpredictably.
4. **Password change or manual sign-out** — invalidates everything instantly.
5. **Workspace policy timeouts / DBSC enforcement** (emerging; untested on
   Workspace accounts — our study is non-Workspace).

### 3.2 Internal persistence hazards (ours)

A separate failure class is easy to misattribute to Google: the CLI corrupting
its own cookie state. GemiTerm's ledger contains **three capture/persistence
path bugs of one pattern** — a name-subset filter correct for one purpose and
silently wrong for another (A1 has the full history). The planned persistence
design ([§7](#7--persistence-design-planned)) bans name-based filtering
outright and adopts notebooklm's resolved hazard set: snapshot/delta CAS
saves, `(name, domain, path)` identity, atomic writes, cross-process locking.
Their #361 ("stale in-memory clobbers fresh disk") is in the same SDK family
as ours and is the reason CAS is non-negotiable.

### 3.3 Empirical cookie requirements **[VALIDATED 2026-08-15]**

Which cookies does Google *actually* require? This backs the planned two-tier
validation gate ([§8](#8--validation-gating-and-the-status-probe-planned)).

**Method.** A raw-`fetch` harness (Bun, Windows) replicating the
`gemini-web-sdk@2.2.0` wire — verified by live probing, not by trusting the
SDK. Cookie selection implemented RFC 6265 domain/path/expiry rules
independently; jars in-memory only; nothing persisted; no cookie values
logged; 4 s pacing between probes; 3× replication of the stress matrix. Zero
gemiterm auth code involved. Environment: account `dhb-zeek` (personal,
non-Workspace), residential IP, 2026-08-15. Exact wire details in
[§6](#6--the-gemini-wire-protocol-reproduction-harness) — the harness is
reproducible from this doc alone.

**Verdict tables** (full data: [docs/cookie-ablation-findings.md](cookie-ablation-findings.md)).

Prototype 1 — full-jar ablation, fresh session, 31 variants:

| Variant | Result |
|---|---|
| baseline (41 cookies) | OK · 14 chats |
| drop-1 × 22 (every auth cookie incl. `SID`, `__Secure-1PSID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `SIDCC`, `NID`, `LSID`, `__Host-1PLSID`, `__Secure-3PSID`, PSIDRTS, PAPISID, GAPS, OTZ) | **OK · 14 chats — every one** |
| drop-1 `__Secure-1PSIDTS` | **DEAD-INIT** (200, no tokens, no redirect) |
| drop-2 `__Secure-1PSIDTS`+`SID` / +`APISID` | DEAD-INIT |
| drop-2 `SID`+`APISID` · drop-3 `APISID`+`SAPISID`+`LSID` (entire companion branch removed) | OK · 14 chats |
| sdk-minimal (`__Secure-1PSID`+`__Secure-1PSIDTS` only) | OK · 14 chats |
| historical trimmed 4-cookie jar (PSID+PSIDTS on `.google.com`/`.youtube.com`) | **OK · 14 chats when fresh** |

Prototype 2 — dormancy, rotate-recovery, L3, stress (3× reps, deterministic):

| Observation | Result |
|---|---|
| 9.1 h idle, zero rotation, byte-unchanged jar | probed **DEAD-INIT** |
| L1 `RotateCookies` on the dead session (2 variants, exact notebooklm wire) | 200 · `hfcr=600` · SIDCC-family minted · **PSIDTS withheld** · init still dead |
| L3 page load on the persistent profile + `state-save` | PSIDTS rotated to a new value · probe **LIVE · 14 chats** · CLI on the restored jar: 14 chats |
| L1 `RotateCookies` on the LIVE (L3-recovered) session | 200 · SIDCC minted · PSIDTS still withheld · **session unharmed** (post-rotate probe OK) |
| Stress matrix: baseline / drop `SID` / drop `__Secure-1PSID` / drop `APISID`+`SAPISID`(+`LSID`) / sdk-minimal | OK × 3/3 each |
| Stress matrix: drop `__Secure-1PSIDTS` | **DEAD-INIT × 3/3** |

**The accept-rule model for Gemini.** For the init GET + `MaZiqc` listChats
pair, on this account:

1. `__Secure-1PSIDTS` valid and fresh ⇒ accepted. It is the **only
   individually-required cookie**.
2. Everything else — including `SID` and `__Secure-1PSID` — is individually
   droppable with full function (Google re-issues mid-call). `APISID`+
   `SAPISID`+`LSID` all removed together: still OK. This is **weaker** than
   notebooklm's rule (their homepage GET requires `SID` + a secondary
   binding); both findings can be true — different app, different accept-rule,
   and both are model fits, not confirmed server mechanisms.
3. Sufficiency is about *shape*; failure is about *freshness*. The dormant
   profile failed not because its jar was malformed but because its PSIDTS was
   superseded server-side. Identical shape + fresh PSIDTS (post-L3) works.

**Caveats (stated honestly).** Single account, non-Workspace, residential IP,
one day. Only init + `MaZiqc` were ablated — **`StreamGenerate` (send) and
`hNvQHb` (readChat) were NOT ablated; companions may matter there.**
Notebooklm's own standard is two-account replication; ours is pending. The
freshness clock (§2.5) applies on top of any accept-rule.

**Consequence — capture policy is NEVER informed by the ablation.** Full-jar
capture with a domain-policy filter, always. Partial extraction is
notebooklm's #1 documented cause of "auth expires immediately", and our three
ledger bugs were all partial-capture variants. The ablation informs
*validation gating* only (§8).

---

## 4 · The recovery ladder

Escalation, cheapest first. Each layer is a fallback for the one below it.

| Rung | Mechanism | Browser? | Status | Revives a decayed session? |
|---|---|:-:|---|---|
| **L1** | Per-invocation HTTP `RotateCookies` POST | No | **[PLANNED]** | No — PSIDTS withheld on our account (§5.3) |
| **L2** | Background keepalive | No | **[PLANNED]** | No — same engine as L1 |
| **L3** | Browser-backed refresh from persistent profile | Yes (headless page load) | **[VALIDATED] — primary engine** | **Yes — resurrected a 9 h DEAD session** |
| **L4** | Master-token re-mint | No | **[FUTURE]** | Yes, by design (not built) |
| **L5** | `GEMITERM_REFRESH_CMD` external hook | Depends | **[PLANNED]** | Depends on the script |
| **L6** | Manual `gemiterm login` | Yes (headed) | **[CURRENT]** | Yes (human-driven) |
| **L7** | OS-scheduled `gemiterm auth refresh` | Yes (L3 inside) | **[PLANNED]** | Prevents decay rather than reviving |

### 4.1 L1 — HTTP `RotateCookies` POST **[PLANNED]**

Fires once per CLI invocation, best-effort, before the first RPC. Wire in
[§5](#5--the-rotatecookies-primitive). Guards:

- **Never a validity signal.** Both historical misdesigns are banned: a
  200-with-no-PSIDTS is *not* session death (it is the current steady state on
  our account), and a 401 is *not* API death (RotateCookies is an
  `accounts.google.com` endpoint with different session policies than the
  Gemini RPC surface — the ledger's 2026-08-09 entry documents a valid session
  killed by exactly this conflation).
- **60 s throttle keyed on actual POST time** (in-memory per-process, like the
  ledger's `a780788` fix — not disk mtime, which unrelated writes refresh).
- **In-flight dedup** so concurrent callers share one POST.
- `GEMITERM_SKIP_ROTATE_COOKIES=1` opt-out.
- Cross-process lock added when L2 lands.

What it buys today: SIDCC-family refresh, the `hfcr` readout, and a harmless
identity-surface poke. What it does not buy: PSIDTS (§5.3).

### 4.2 L2 — background keepalive **[PLANNED]**

REPL-scoped automatic keepalive plus `GEMITERM_KEEPALIVE=<sec>` env opt-in for
automation; 600 s default (matching `hfcr`), 60 s floor. Given the
PSIDTS-withholding finding, L2's HTTP pokes may only refresh SIDCC on affected
accounts — **browser-backed refresh is the reliable engine; L2 remains cheap
insurance** and keeps the identity surface warm. Re-evaluate if L1 mint
recovers (canary table, §9).

### 4.3 L3 — browser-backed refresh from the persistent profile **[VALIDATED] — primary engine**

A page load on the persistent Chromium profile rotates PSIDTS via Google's
own page JS. Validated end-to-end (playwright-cli, daemon-based): it
resurrected a 9-hour DEAD session.

The flow, exactly as validated (see [docs/PLAYWRIGHT_CLI_API.md](PLAYWRIGHT_CLI_API.md)):

```bash
# 1. Open a headless page on the profile's ABSOLUTE user-data dir.
#    (--headed instead for interactive login, i.e. L6.)
bunx @playwright/cli -s=<session> open --browser=chromium --persistent \
  --profile=<ABS profileDir> https://gemini.google.com/app

# 2. Wait ~10-12 s for page JS to complete rotation.

# 3. Export the full Playwright StorageState.
bunx @playwright/cli -s=<session> state-save <file>

# 4. Close the session (graceful; the persistent profile persists on close).
bunx @playwright/cli -s=<session> close
```

Design notes:

- The profile dir doubles as the persistent user-data dir ⇒ **device
  continuity** ⇒ Google treats the refresh as a familiar device. This is the
  bot-detection shield at login time (notebooklm's rationale for persistent
  profiles, confirmed by our headed-login experience).
- **Triggers:** phantom detected at the response layer (§2.6); dead-session
  recovery; explicit `gemiterm auth refresh` (planned command, also the L7
  unit).
- **Outcomes:** SUCCESS (fresh PSIDTS; save gated as below) / FAILED (the
  profile's browser session is also dead ⇒ headed re-auth, L6).
- **Anti-pattern (adapted from notebooklm A4): NEVER `state-save`
  unconditionally after a page that redirected to an `accounts.google.com`
  sign-in.** The login page sets anonymous cookies (`NID`, `OTZ`, `__Host-GAPS`,
  …) and an unconditional save persists *only those*, destroying real auth
  cookies. Gate the save on confirmed-authed state — init tokens present in
  the HTML, or a successful listChats RPC — before writing.
- **Persistent-profile headless context caveats (notebooklm A3):** known
  Playwright bugs with long-lived `launch_persistent_context` (missing
  cookies, profile-DB corruption). We use **short-lived page loads per
  refresh**, not a resident daemon browser. CDP-attach to a real enrolled
  Chrome is the future escape hatch if DBSC extends to non-Chrome paths.

### 4.4 L4 — master-token re-mint **[FUTURE]**

Documented fully so a future agent can build it without re-derivation;
reference notebooklm [ADR-0023](https://github.com/teng-lin/notebooklm-py/blob/main/docs/adr/0023-master-token-headless-auth.md).
Not in v1 ([§11](#11--relationship-to-current-code--openspec)).

- **Credential.** A durable Google master token (`aas_et/…`), obtained once
  from a one-time `accounts.google.com/EmbeddedSetup` browser sign-in, stored
  as `master_token.json` mode 0600 beside `storage_state.json`. Per-install
  `android_id` (`secrets.token_hex(8)`-class random). It re-mints web cookies
  on demand via
  `perform_oauth → OAuthLogin?issueuberauth=1 → MergeSession`, and survives
  cookie expiry AND password changes until explicitly revoked.
- **PSIDTS interaction.** The mint yields `SID`+`APISID`+`SAPISID` but **not**
  `__Secure-1PSIDTS`; fire one best-effort `RotateCookies` POST after mint to
  top it up (and on accounts like ours, accept that it may be withheld — L3
  remains the fallback).
- **Security.** Full-account, infostealer-grade credential. Dedicated /
  throwaway account only; never logged or committed; single-consumer (N
  workers re-minting concurrently invalidate each other's `SID`); standing
  DBSC risk — re-mint is itself the mitigation while unsigned paths remain
  unenforced.
- **Recommended for future unattended/server use** once built.

### 4.5 L5 — external refresh hook **[PLANNED]**

`GEMITERM_REFRESH_CMD=<command>` fires on auth-expiry signals. Contract: the
command rewrites `storage_state.json` (or the profile state) and exits 0; the
CLI retries once. Scrub secret-bearing env from the child; serialize the
subprocess across processes (a per-path lock) so N gemiterm invocations don't
spawn N recovery commands. Orthogonal to L1–L4: those keep a live session
fresh; L5 is "we lost it anyway — run my script."

### 4.6 L6 — manual `gemiterm login` **[CURRENT]**

Headed browser sign-in on the persistent profile. The only fully-working
recovery in the shipped CLI today.

### 4.7 L7 — scheduled refresh **[PLANNED]**

`gemiterm auth refresh` as a one-shot (L3 page load + gated save) driven by
Task Scheduler (Windows) / systemd timer / launchd / cron. Cadence 15–20 min,
**off-minute** (e.g. `7,27,47 * * * *`) to avoid fleet collision. Keeps idle
profiles between CLI runs from ever decaying — a cheaper automation answer
than a daemon. Note the history: a background auth-daemon proposal exists in
OpenSpec (`auth-daemon`, commit `f747fc6`); **the ladder reframes it — L7
scheduling + L3 refresh is the chosen shape, not a resident OS service.** A
resident daemon multiplies failure modes ("daemon died", sleep/resume
lifecycle, autostart permissions) for a single-process CLI.

---

## 5 · The `RotateCookies` primitive

### 5.1 The endpoint

Wire byte-matched from notebooklm's `_auth/mint_service.py` (itself derived
from HanaokaYuzu/Gemini-API):

```
POST https://accounts.google.com/RotateCookies
Content-Type: application/json
Origin: https://accounts.google.com

[000,"-0000000000000000000"]
```

- **Headers: ONLY those two.** No `User-Agent`, no `Referer` — the HTTP
  client's default UA goes out (notebooklm sends httpx-default; our harness
  replicated the SDK's `axios/1.19.0`). Unknown whether Google requires any
  specific UA.
- The body is a JSPB sentinel: `000` is `0` with leading zeros (valid in
  Google's JSPB parser, invalid in strict JSON); `"-0000000000000000000"`
  means "no prior `__Secure-1PSIDTS` — mint fresh from persistent identity
  alone."
- `follow_redirects: true`, and **collect `Set-Cookie` from EVERY redirect
  hop** (httpx jar semantics). A single-response read misses hops.

### 5.2 The successful response

```
HTTP/1.1 200 OK
Set-Cookie: SIDCC=<new>; Domain=.google.com; Secure
Set-Cookie: __Secure-1PSIDCC=<new>; …
Set-Cookie: __Secure-3PSIDCC=<new>; …
Set-Cookie: NID=<new>; …

)]}'\n[["identity.hfcr",600],["di",<counter>]]
```

`)]}'` is Google's anti-XSSI prefix. `["identity.hfcr",600]` declares the
recommended rotation cadence in seconds (`hfcr` = high-frequency cookie
rotation); `["di",N]` is an opaque session counter that increments per call
(observed 14 → 15 across two probes).

### 5.3 Field finding: PSIDTS withheld (4/4 attempts)

**[VALIDATED]** On account `dhb-zeek`, 2026-08-15, across four attempts —
fresh session, stale session, sentinel-stripped (PSIDTS removed from the
outgoing jar), and live L3-recovered session — the endpoint returned **200
with `hfcr=600` and minted the SIDCC family (`NID`, `SIDCC`,
`__Secure-1/3PSIDCC`) but NEVER minted `__Secure-1PSIDTS`.**

This matches notebooklm's canary "Gemini-API's bare-sentinel rotation reported
decaying under DBSC" — the upstream warning for exactly this primitive.
Consequences:

- On this account, today, **HTTP rotation is a cheap best-effort supplement**
  (SIDCC refresh, `hfcr` readout) — **not a PSIDTS engine.**
- Harmlessness confirmed: the post-rotate probe on the live session stayed
  OK (14 chats).
- **Re-verify periodically.** If PSIDTS-mint returns, L1 gains primary-engine
  status and L3 becomes the fallback (canary table, §9).

### 5.4 Throttling and guards **[PLANNED]**

See L1 (§4.1): 60 s floor keyed on actual POST time, in-flight dedup, env
opt-out, cross-process lock when L2 lands. Hammering the endpoint triggers
429. Guards key on the canonical profile path so two spellings of one profile
collapse onto one throttle slot.

---

## 6 · The Gemini wire protocol (reproduction harness)

Everything here is **[VALIDATED]** byte-level: extracted from
`gemini-web-sdk@2.2.0` and confirmed by live probing. Another agent must be
able to rebuild the ablation harness from this section alone. No cookie values
anywhere — substitute `<value>`.

### 6.1 Init: the app GET

```
GET https://gemini.google.com/app
Content-Type: application/x-www-form-urlencoded;charset=utf-8
Origin: https://gemini.google.com
Referer: https://gemini.google.com/
Cookie: <full jar, RFC 6265-selected>
```

Use `redirect: manual` so a redirect-to-signin is also observable (Gemini
usually serves 200 signed-out HTML instead — catch both). The SDK warms up
with a cookieless `GET https://www.google.com` first and harvests `Set-Cookie`
(e.g. `NID`); the harness replicated this.

### 6.2 Token extraction regexes

Run against the init HTML:

```js
/"SNlM0e":\s*"(.*?)"/   // at-token (RPC authorization)
/"cfb2h":\s*"(.*?)"/    // build label → bl= query param
/"FdrFJe":\s*"(.*?)"/   // f.sid
/"TuX5cc":\s*"(.*?)"/   // hl (language)
```

All-null ⇒ signed out ⇒ DEAD. Tokens present ⇒ proceed.

### 6.3 listChats: the `MaZiqc` batchexecute RPC

```
POST https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=MaZiqc&hl=en&_reqid=<5-digit>&rt=c&source-path=%2Fapp&bl=<cfb2h>&f.sid=<FdrFJe>
Content-Type: application/x-www-form-urlencoded;charset=utf-8
Origin: https://gemini.google.com
Referer: https://gemini.google.com/
Cookie: <jar>
X-Same-Domain: 1
x-goog-ext-525001261-jspb: [1,null,null,null,null,null,null,null,[4,5,6,8],null,null,null,null,null,null,null]
x-goog-ext-73010989-jspb: [0]
```

Body: `at=<SNlM0e>&f.req=` followed by the URL-encoded form of

```
[[["MaZiqc","<payload>",null,"generic"]]]
```

**The nesting is TRIPLE**: the payload string (itself JSON, e.g.
`[13,null,[1,null,1]]`) sits inside the RPCData array inside the `f.req`
array. Getting this wrong yields an `af.httprm` 400. Two payloads are run in
practice: `[13,null,[1,null,1]]` and `[13,null,[0,null,1]]`.

The SDK's UA is `axios/1.19.0`; the harness replicated it. Unknown whether
Google requires it.

### 6.4 Response framing

The response body is the `)]}'` anti-XSSI prefix followed by frames of

```
<utf16-byte-length>\n<JSON>
```

Chat list extraction: take frame `[2]` (a string) → `JSON.parse` → its `[2]`
array; per chat: `[0]` = conversation id, `[1]` = title, `[2]` = pinned flag,
`[5]` = timestamp pair.

### 6.5 SDK transport facts (and the static-`models()` trap)

- The SDK constructs its client from ONLY `secure_1psid` + optional
  `secure_1psidts` — a **2-cookie wire surface**. No companion cookies are
  ever sent by the SDK. (The ablation's sdk-minimal variant confirms 2
  cookies suffice for init + listChats when fresh.)
- The SDK passively merges `Set-Cookie` after each call; no rotation anywhere
  in the SDK.
- **TRAP: `models()` in gemini-web-sdk is a STATIC TABLE — zero network.**
  The historical "models probe" was unknowingly just the init GET. Any probe
  must be an init-GET or a real RPC (e.g. listChats limit 1); `models()`
  result contents prove nothing about the RPC surface.

---

## 7 · Persistence design **[PLANNED]**

Mirrors notebooklm's resolved hazard set, adapted to our ledger's scar tissue:

- **Full-jar capture with a domain-policy filter.** REQUIRED domains:
  `.google.com`, `gemini.google.com`, `accounts.google.com`. OPTIONAL/never by
  default: youtube / mail / docs cookies (data minimization — a stolen
  `storage_state.json` should not open Gmail). **Name-based subset filtering
  is BANNED** — all three ledger bugs (A1) were name-set filters
  (`REQUIRED_COOKIES`, `COOKIE_NAMES_OF_INTEREST`, `REFRESH_COOKIE_NAMES`).
  The filter axis is domain, never cookie name.
- **Snapshot/delta CAS save.** Snapshot `(name, domain, path) → value` at
  load; on save, write only deltas whose on-disk value still matches the
  snapshot. Prevents a stale in-memory jar from clobbering a fresher disk
  state a sibling process rotated (notebooklm #361 — the bug in our own SDK
  family; our ledger's L2-corruption entries are the same class).
- **Atomic writes** — temp file + rename; never truncate-in-place.
- **Cross-process lock** with `LockUnavailableError` semantics: Windows
  create/retry; **fail-closed for full-file writers, fail-open for CAS merges**
  (the CAS guard itself prevents lost updates, so availability wins there).
- **Cookie identity is `(name, domain, path)`** — never name-only, never
  `(name, domain)` (path-collapse hazard).

---

## 8 · Validation gating and the status probe **[PLANNED]**

Two tiers, informed by — but isolated from — capture policy:

- **Tier 1 (raise-or-warn):** `__Secure-1PSIDTS` present **AND routable** —
  RFC 6265 simulation against `accounts.google.com` (expiry + domain/path
  matching), not just name presence. A present-but-unroutable PSIDTS is
  treated as missing. Plus `__Secure-1PSID` present as the practical identity
  anchor — whether this raises or warns is a marked **design decision**
  (ablation says droppable; practice says it is the SDK's primary credential).
- **Tier 2 (warn once):** companion set present (`SID`/`HSID`/`SSID`/
  `APISID`/`SAPISID`…) — defense in depth for the un-ablated surfaces
  (StreamGenerate, readChat), never a capture trim.
- **`gemiterm status` probe:** the §2.6 classifier, read-only, no side
  effects — init tokens + listChats limit 1. Phantom ⇒ suggest/trigger L3
  recovery; dead ⇒ recovery ladder from L3 down.

---

## 9 · Canaries and signals

Tripwires that would shift the threat model:

| Signal | Meaning | Action |
|---|---|---|
| `RotateCookies` 401 in production | DBSC extended to non-Chrome paths | Harden browser-backed L3; build the CDP-attach arm |
| `RotateCookies` 200-but-no-PSIDTS | **CURRENT STATE on our account** | Don't rely on L1 for PSIDTS; monitor for recovery |
| Phantom detected on a fresh (< 10 min) session | Not rotation drift | Investigate risk-scoring / IP / other-client supersession |
| Init GET serves tokens again after a RotateCookies `hfcr`-only probe | L1 mint recovered | Consider promoting L1 to primary engine |
| Chrome DBSC GA / Workspace session-binding leaves beta | Enforcement wave approaching | Reassess L4 master-token and CDP plans |

---

## 10 · References

- [teng-lin/notebooklm-py — auth-cookie-lifecycle.md](https://github.com/teng-lin/notebooklm-py/blob/main/docs/auth-cookie-lifecycle.md)
  — the structural model for this doc; source of the four-timers table, the
  recovery-ladder taxonomy, the RotateCookies wire, and the A3/A4
  anti-patterns adapted above.
- notebooklm ADRs:
  [ADR-0023 master-token headless auth](https://github.com/teng-lin/notebooklm-py/blob/main/docs/adr/0023-master-token-headless-auth.md)
  (L4 design), ADR-0029 canonical storage writer, ADR-0030 one recovery
  ladder.
- [HanaokaYuzu/Gemini-API](https://github.com/HanaokaYuzu/Gemini-API) —
  upstream reference for the `RotateCookies` sentinel
  (`src/gemini_webapi/utils/rotate_1psidts.py`).
- [W3C DBSC spec](https://w3c.github.io/webappsec-dbsc/).
- In-repo: [docs/cookie-ablation-findings.md](cookie-ablation-findings.md),
  [docs/archive/phantom-bug-synthesis.md](archive/phantom-bug-synthesis.md),
  [docs/PLAYWRIGHT_CLI_API.md](PLAYWRIGHT_CLI_API.md),
  [AGENTS.md](../AGENTS.md).

---

## 11 · Relationship to current code + OpenSpec

This doc is the design target for the planned **`CookieSession` deep-module
replacement**: a single `ensureSession(profile)` facade over collaborators
capture / store / rotate / validate / recover, with an injectable clock and
async-first APIs per repo convention. The current spread
(`ProfileAuthManager`, `AuthService`, `CookieMonitor`, `cookie-rotation.ts`,
`cookie-storage-service.ts`, `GeminiClientService` persistence) becomes the
module's internals.

**Grilling-settled scope for v1** — full mirror of notebooklm minus the
master token:

- browser capture via the persistent profile (full jar, domain filter);
- L1 best-effort rotation with the §4.1 guards;
- two-tier validation with routability (§8);
- reactive phantom detection at the response layer (§2.6);
- L3 browser-backed refresh in v1 (§4.3).

**Open (unsettled) items, stated honestly:**

- **Capture driver** — playwright-cli subprocess (the validated path; matches
  the repo's existing `@playwright/cli` architecture) vs. the direct
  playwright package (fewer moving parts, new dependency shape).
- **CAS + lock scope** — which writes are full-file (fail-closed) vs. CAS
  merges (fail-open); lock granularity per profile vs. per file.
- **Keepalive surface details** — REPL hook placement, `GEMITERM_KEEPALIVE`
  floor/default interplay with L1's throttle.
- **OpenSpec change sequencing** — the ladder touches the `auth` spec delta
  already carried by open changes (`cookie-jar-integrity` implemented but not
  archived; the `auth-daemon` proposal `f747fc6` reframed as L7+L3 per §4.7);
  archive order matters to avoid delta conflicts.

---

## Appendix: field notes & bug history

### A1 · Bug history: the phantom saga (v2.4.0 → v2.7.x)

Condensed from [docs/archive/phantom-bug-synthesis.md](archive/phantom-bug-synthesis.md)
(the write-once ledger is authoritative for detail). Several of its
hypotheses are now **disproven by the 2026-08-15 ablation** — noted inline;
do not re-litigate them.

| When | Event | Verdict today |
|---|---|---|
| v2.4.0 (and earlier) | `CookieMonitor` filters the browser jar to `REQUIRED_COOKIES` = {PSID, PSIDTS} before persisting — every capture path (headed login, silent refresh) produces a 4-cookie jar. | Real bug, fixed `6bc51f6` (2026-08-06). **But its causal story — "listChats needs companions" — is disproven**: the trimmed jar works when fresh; the recurring 0-chats symptom was PSIDTS decay. The fix stands as jar hygiene. |
| v2.6.0–v2.6.2 | Detection + rotation arc: L1 `RotateCookies` POST, `models()` probe, L2 escalation on server decline, `(name, baselineValue)` merges. | Operated on an already-trimmed jar, and on misread rotation signals. The probe trap: `models()` is a static table (§6.5) — the probe only ever re-ran the init GET. |
| 2026-08-06 PM | **4-cookie discovery**: live jars show exactly PSID+PSIDTS on `.google.com`/`.youtube.com`; "next expiry 364d" yet 0 chats. Capture fix lands (`6bc51f6`). | The discovery was correct as a jar-integrity finding. The ablation later showed the same 4-cookie shape probes OK when PSIDTS is fresh — the *decay*, not the *width*, caused the symptom. |
| 2026-08-06–09 | Recovery-ladder recurrences: RotateCookies 401 treated as session death kills valid sessions (fixed `85f3e7f`); full-mode L2 `mergeCookies` replaces companions with another session's cookies (removed `f681c66`); targeted L2 filters to `COOKIE_NAMES_OF_INTEREST`, discarding `__Secure-1PSID` rotation (`0f9154f` introduced, `f681c66` amplified, fixed 2026-08-10). | The **three capture-path filtering bugs** — one pattern, three name-set filters (§7's ban). The 401 episode is anti-pattern A2.3. |
| 2026-08-08–11 | Dormancy characterized: phantom onset ≤ ~1h15m idle, dead by ~6–9 h; WSL cross-check proves code-not-environment; reactive response-layer phantom detection lands. | Consistent with the ablation: PHANTOM is an earlier stage of the same PSIDTS decay that ends in DEAD. |
| 2026-08-15 | **Ablation study** (this doc's §3.3, §5.3): root cause proven server-side PSIDTS supersession under zero rotation; L1 PSIDTS-withholding observed; L3 resurrection validated. | Closes the saga: the phantom bug was never capture width, probe design, or merge semantics alone — it was an unrotated freshness cookie plus three filtering bugs compounding the damage. |

### A2 · Anti-patterns (each with our own scar tissue)

1. **Name-subset cookie filtering.** `REQUIRED_COOKIES` capture-trim,
   `COOKIE_NAMES_OF_INTEREST`, `REFRESH_COOKIE_NAMES` — three ledger bugs, one
   pattern. The permanent fix is no name filters at all: domain-policy filter
   + `(name, domain, path)` merge (§7).
2. **Persisting on login-redirect pages** (notebooklm #312 / A4). An
   unconditional `state-save` after a page that redirected to
   `accounts.google.com` sign-in persists anonymous cookies over real auth
   cookies. Gate saves on confirmed-authed state (§4.3).
3. **Treating the RotateCookies response as a session-validity oracle.** Two
   ledger entries: 401-kills-valid-session (2026-08-09); 200-but-no-PSIDTS
   triggering harmful L2 (2026-08-06). It is a rotation endpoint, not a probe.
4. **Last-writer-wins full-jar saves from stale in-memory jars** (notebooklm
   #361 class; our L2-corruption entries). Snapshot/delta CAS or nothing.
5. **Trusting cookie `expires` attributes.** Supersession makes them
   meaningless — a 365-day-stamped PSIDTS can already be rejected (§2.5).
6. **The static-`models()` probe trap.** `models()` does no network (§6.5);
   probes must be init-GET or a real RPC.

### A3 · Ruled-out experiments

- **WebDriver-stealth tools for Google login** (`undetected-chromedriver`,
  `selenium-stealth`, `playwright-stealth` — notebooklm A3): Google's signal
  fusion wins; repeatedly broken across Chrome bumps. Not for Google flows.
- **Client-side DBSC**: impossible from a non-browser client — the W3C spec
  is TPM/attestation-bound by construction. Escape is the L3 browser path /
  CDP attach, not a reimplementation.
- **Reading Chrome's cookie DB on Windows**: Chrome 127+ App-Bound Encryption
  makes it admin-or-bust. If browser-cookie import is ever added, **Firefox is
  the viable rookiepy path**.

### A4 · Open questions

- Does RotateCookies PSIDTS-mint recover (DBSC rollback)? Re-verify
  periodically (§5.3, §9).
- Do `StreamGenerate` (send) and `hNvQHb` (readChat) need companions? Not
  ablated; Tier-2 warning covers the gap until tested.
- Does the phantom→dead boundary have a predictable clock? Observed ~1–2 h
  phantom onset (tightest floor ~1h15m idle) and dead by 9 h; the exact curve
  is unknown, and no local signal predicts it.
- Two-account replication of the ablation matrix — pending (offered, not yet
  required for design decisions).

---

## Changelog

- **2026-08-15** — initial version. Embeds the 2026-08-15 ablation study
  (validated): PSIDTS as sole individually-required cookie, PSIDTS
  supersession as phantom root cause, RotateCookies PSIDTS-withholding,
  L3 browser-backed resurrection. Establishes the L1–L7 ladder with
  [CURRENT]/[PLANNED]/[FUTURE] statuses, the planned persistence and
  validation-gating designs, and the `CookieSession` design target.

- **2026-08-16** — fix-4 auth-regression guards. (1) `writeFileExclusive`
  (`src/infrastructure/io.ts`) now ensures the parent directory before the
  exclusive create, so the first capture into a fresh profile dir no longer
  fails with ENOENT on the lock file. (2) Added the `tests/auth-regression/`
  invariant suite (on-disk assertions for every historical bug class), the
  auth-sensitive-path gate (`bun run check:auth-gate`), and the nightly
  mutation canary (`bun run canary:auth`). (3) Documentation consolidation:
  this doc is the canonical authority; `docs/archive/` holds the closed
  write-once ledger and superseded plans (see `docs/README.md`).

- **2026-08-17** — await-detached-rotation-on-empty-list. The first `list`
  after the phantom-onset idle window (~1h15m) armed the superseded jar,
  printed `No conversations found.`, and exited while the detached
  refresh-runner it had spawned rotated PSIDTS seconds later — the empty-result
  path raced and lost against the rotation it itself triggered. The facade now
  records the armed PSIDTS baseline + staleness at arm time and exposes
  `waitForRotation(profile)` (bounded 30 s poll of the on-disk jar for a
  PSIDTS change; passive — spawns/writes nothing; never rejects) and
  `rotationInFlight(profile)`. `list`'s empty-result path awaits an in-flight
  rotation and retries the query once before classifying — for BOTH the
  single-profile form and the aggregate default listing (field round 1 showed
  the user's plain `list` is the multi-profile fan-out, which the initial
  single-profile-only placement silently skipped); on timeout it hints on
  stderr naming the still-in-flight profiles (stdout bytes unchanged).
  Arm-first D2 is untouched — fresh jars add zero latency; the wait engages
  only after a listing already failed. Invariant coverage:
  `tests/auth-regression/invariant-await-rotation.test.ts`
  (openspec/changes/await-detached-rotation-on-empty-list).

- **2026-08-18** — cancel-auth-on-browser-close. Closing the headed browser
  during `gemiterm auth --add <profile>` previously produced a five-minute
  stream of `Gate poll failed` debug lines before the existing
  `LoginTimeoutError` finally fired — masking the user's actual action
  (cancel). `CookieSession.waitForGate` now classifies `PlaywrightCliError`
  stderr text via a new shared helper `isBrowserClosedError`
  (`src/services/playwright-cli-driver.ts`, matches `is not open` and the
  existing `not found` teardown marker, both case-insensitive, only on
  `PlaywrightCliError` instances). On a classified error the gate loop emits
  one info-level `Gate poll cancelled` log and throws a new typed
  `LoginCancelledError` (`src/core/errors.ts`); the capture `finally` still
  runs `closeSession` (now pointing at the same helper, so `is not open`
  during teardown is also swallowed). `cookieListFromState` and
  `saveFullJar` are unreachable after cancellation, so a pre-existing jar is
  preserved byte-for-byte. The CLI top-level handler renders the typed error
  as a friendly info message and exits 0; the generic `Command 'auth' failed`
  path is unchanged for every other error. `closeSession` reuses the same
  helper to swallow `is not open` during teardown (no behavior change on the
  happy path). Invariant coverage:
  `tests/auth-regression/invariant-capture-integrity.test.ts` (new
  `capture cancellation on browser close` block) + unit + integration tests
  on the gate loop, the classifier, and the `AuthCommand` propagation path
  (openspec/changes/cancel-auth-on-browser-close).

