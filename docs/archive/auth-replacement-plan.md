> **ARCHIVED (2026-08-16) - superseded by docs/auth-cookie-lifecycle.md (canonical) and docs/cookie-ablation-findings.md (empirical record).** Historical reference only; not normative. See docs/README.md for the documentation authority order.

# Auth Replacement Plan — CookieSession (2026-08-15)

The post-grilling plan to replace GemiTerm's auth implementation with a notebooklm-py-mirrored design, adjusted to first-principles evidence gathered on this codebase. Evidence base: `docs/cookie-ablation-findings.md` (empirical, raw-wire, zero gemiterm auth code), notebooklm-py `docs/auth-cookie-lifecycle.md` + ADRs 0023/0029/0030, and the grilling decisions below.

## Settled decisions (grilling, rounds 1–2)

| # | Decision | Settled |
|---|---|---|
| Q1 | Scope | Full mirror **minus** master-token/L4; L3 headless recovery in v1 |
| Q2 | Capture | Full browser jar + **domain-policy filter** (never name filtering) |
| Q3 | Interface | Single `CookieSession` facade; collaborators injected via deps-object |
| Q4 | HTTP RotateCookies | **Omitted in v1** (void on this account: 200/`hfcr=600` but PSIDTS withheld 4/4). Wire documented for future L4 |
| Q5 | Validation | Ablation-derived: tier-1 raise = `__Secure-1PSIDTS` routable + `__Secure-1PSID` present; tier-2 warn = companion set; reactive phantom detection at response layer |
| Q6 | Recovery rungs | Browser-backed refresh (primary engine) + L3 + headed re-login terminal |
| Q7 | Browser surface | `playwright-cli` for everything (headed login, headless refresh/recovery, capture) |
| Q8 | Refresh policy | Post-arm opportunistic (detached refresh when jar stale) + reactive L3 retry-once + REPL interval loop |
| Q9 | Storage | Snapshot/delta CAS + cross-process lock; **pure in-process Bun fs** — no shell, no flock — cross-OS and shell-agnostic by construction |
| Q10 | status probe | Behind `status --verbose` only |
| Q11 | OpenSpec | Three changes: `cookie-session-core` → `phantom-detection` → `session-keepalive` |
| Q12 | L1 HTTP rotate | Skipped (see Q4) |

## Target architecture

```
src/auth/
  cookie-session.ts        facade — the ONE public surface
  browser-refresher.ts     playwright-cli: openHeaded / openHeadless (persistent --profile), cookie polling, state-save, close
  cookie-store.ts          load / CAS save / lock file (cross-OS)
  cookie-validation.ts     tier-1 / tier-2 / RFC 6265 PSIDTS-routability predicate
  session-classifier.ts    init-token check + listChats(limit:1) → live | phantom | dead
  recovery.ts              L3 flow: refresh → persist → retry once; else AuthenticationError
  refresh-runner.ts        standalone detached process (also the future cron/L7 surface)
```

```ts
export interface CookieSession {
  ensureSession(profile: string): Promise<{ cookies: Cookie[] }>;   // arm now + opportunistic detached refresh + reactive net
  captureLogin(profile: string): Promise<{ cookies: Cookie[] }>;    // headed login → full-jar capture → persist
  probe(profile: string): Promise<"live" | "phantom" | "dead">;     // read-only; powers status --verbose
  refresh(profile: string): Promise<{ rotated: boolean }>;          // synchronous headless browser-backed rotation
}

export interface CookieSessionDeps {                                 // DI seam, repo convention
  browser: BrowserRefresher;
  store: CookieStore;
  validator: CookieValidator;
  classifier: SessionClassifier;
  recovery: RecoveryRung;
  logger: Logger;
}
```

`GeminiClientService` keeps its 2-cookie SDK surface (`secure1psid`/`secure1psidts` extracted from the armed jar). The facade replaces `ProfileAuthManager.ensureAuthenticated`; `BrowserRefresher` replaces `AuthService`+`CookieMonitor`; `CookieStore` replaces `CookieStorageService`+`CookieStorage`. Legacy files deleted in change 1 once green.

### Capture (the H6 lesson, structurally impossible to repeat)

Gate ≠ payload. Headed login polls `cookie-list` (text parse, existing driver pattern) until `__Secure-1PSID` + `__Secure-1PSIDTS` are present; the **payload** is then `state-save` — the complete jar, domain-filtered only: keep `.google.com`, `.youtube.com`, `accounts.google.com` (the domains observed in the validated 41-cookie baseline). No cookie-name sets exist anywhere in the capture path.

### Refresh engine (the phantom-bug kill shot)

RPC/init traffic never rotates PSIDTS (proven); HTTP RotateCookies is withheld (proven); browser page-load rotation works headless on the persistent profile (proven, resurrected a 9h-dead session). Therefore:

1. **Arm first**: every command constructs from the on-disk jar immediately (zero added latency; shape-valid legacy jars keep working).
2. **Detached opportunistic refresh**: if `storage_state.json` mtime is older than 30 min, spawn detached `refresh-runner.ts <profile>` (headless `open --persistent --profile` → poll until PSIDTS value ≠ disk baseline or timeout 60 s → `state-save` → CAS-merge → `close` → exit). Benefits the *next* command.
3. **Reactive net**: on a command observing phantom/dead (classifier), run *synchronous* L3 refresh + retry the operation once; failure → `AuthenticationError` → headed re-login prompt.
4. **REPL loop** (change 3): interval every 10 min while the interactive session is open.

Legacy 2/4-cookie jars self-upgrade to full jars via the detached refresh — no user re-login needed unless dead.

### Storage: CAS + lock (ADR-0029 mirror, cross-OS)

- Snapshot `(name, domain, path) → value` at load; save writes only this process's deltas, and only where on-disk still matches the snapshot (stale-overwrite-fresh prevention, notebooklm #361 class).
- One sibling lock file per profile (`storage_state.json.lock`), acquired via exclusive create (`Bun.write` + `createNew: true`), 100 ms retry: CAS saves wait up to 10 s then proceed **fail-open**; full-file writers wait up to 90 s then throw typed `LockUnavailableError` (**fail-closed**). Stale lock (>120 s mtime) is stealable. Pure Bun fs — Windows/POSIX identical, no shell commands, no bash/PowerShell surface at all.
- `storage_state.json` format unchanged (Playwright storage state) — existing profiles migrate transparently.

### Validation & classification

- Tier-1 (raise): `__Secure-1PSIDTS` **routable** to `gemini.google.com` under RFC 6265 selection (present, unexpired, domain/path scope actually delivers it) AND `__Secure-1PSID` present.
- Tier-2 (warn once): companion set absent (`SID`/`HSID`/`SSID`/`APISID`/`SAPISID`/`SIDCC`/`NID`) — ledger-hedged, not ablation-required; un-ablated surfaces (StreamGenerate/readChat) may want them.
- Classifier: `GET /app` token check (real network auth surface — the SDK's `models()` is a static table and must never be used as a probe) + `listChats({limit:1})`. tokens✓+chats≥1 = live; tokens✓+0 = phantom; tokens✗ = dead.

## OpenSpec sequencing

1. **`cookie-session-core`** — `src/auth/` module in full (facade, browser-refresher + driver extensions `openHeadless`/`stateSave`/`closeSession`, CAS store + lock, validation, domain filter, refresh-runner), factory wiring in `cli/index.ts`, delete legacy auth services, update AGENTS.md sensitive-area doctrine. Kills the phantom bug alone.
2. **`phantom-detection`** — classifier + reactive retry-once at the query layer + `status --verbose` probe column.
3. **`session-keepalive`** — REPL interval loop; note the cron/L7 surface (`refresh-runner` is already it).

## Test strategy

Fakes at `BrowserRefresher`/`CookieStore` seams. Regression pins (RED-on-regression): full-jar capture with no name filtering; gate≠payload; CAS prevents stale-overwrite-fresh; tier-1 raises on missing/unroutable PSIDTS; phantom vs dead classification; L3 retry-exactly-once; REPL keepalive start/stop lifecycle. Existing CLI integration tests stay green (non-interactive outputs byte-equivalent).

## Verification checkpoints

1. After change 1: typecheck + full suite green; live fresh-login → 41-cookie-equivalent jar; **`gemiterm list` after >1 h idle returns chats** (the phantom-bug kill test — historically fails within ~1 h 15 m).
2. Fresh profile from user (requested when change 1 lands): fresh-login flow + optional cross-account harness replication (notebooklm's two-account standard; harness already in `.gemiterm/harness/`).
3. Canary watch: if headless page-load rotation ever stops rotating PSIDTS (DBSC creep), the documented RotateCookies wire + L4 master-token path is the prepared escalation.

## Explicitly out of scope (v1)

HTTP `RotateCookies` L1 (wire documented, future L4 consumer) · master-token L4 · `REFRESH_CMD` hook · rookiepy browser-cookie import · cross-account ablation replication (optional, checkpoint 2).
