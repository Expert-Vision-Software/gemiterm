# Auth Rewrite Plan

> **Status:** Draft — synthesized from 2-round grilling session against `teng-lin/notebooklm-py` (2026-08-12).
> **Background:** `docs/phantom-bug-synthesis.md` — the write-once bug ledger.
> **Key insight:** `HanaokaYuzu/Gemini-API#203` (the same SDK lineage GemiTerm is built on) documents a "few hours then silent death" pattern identical to phantom-auth. notebooklm-py's response was active `RotateCookies` L1 rotation + a recovery ladder. GemiTerm's response (per the ledger) was removing the machinery it had and moving toward v2.4.0 minimalism. This plan lands on a hybrid: keep the minimal auth gate, add only the one rotation primitive that notebooklm-py's #2161 proved was load-bearing.

---

## 1. Design decisions (grilling outcomes)

| # | Decision | Grilling round |
|---|----------|---------------|
| Direction | **Hybrid** — minimal auth gate + RotateCookies L1, no full recovery ladder | Round 1 — Q1=C |
| Rotation | RotateCookies as **best-effort rotation**; session validity judged by Gemini API endpoints only (never by 401 from RotateCookies) | Round 1 — Q2=C |
| Interface | **Single `AuthProvider`** public interface; designed as library-quality, extractable into `gemini-web-sdk` later | Round 1 — Q3=A |
| Sync/async | **Sync** | Round 1 — Q4=A |
| Module | **Greenfield `src/auth/`** module; old `services/auth-*.ts` deprecated then removed | Round 1 — Q5=A |
| Recovery rungs | v1 = L1 (RotateCookies) + reactive phantom detection (existing) + headed reauth prompt (existing); **defer L2/L3/L4** | Round 1 — Q6 |
| Interface surface | `AuthProvider` = `login` + `ensureAuthenticated` + `probe` (3 methods) | Round 2 — Q7=B |
| Storage | **Atomic writes** for v1; store interface designed so snapshot/delta CAS is a non-breaking upgrade; **no cross-process locking in v1** | Round 2 — Q8=A |
| Capture | **Full jar** from `playwright-cli` driver + **domain-based filtering** (REQUIRED/OPTIONAL tiers); no name-based subsetting | Round 2 — Q9=A |
| Validation | **Two-tier name-set preflight** (Tier1: `{SID, __Secure-1PSIDTS}`; Tier2: `OSID` or `{APISID, SAPISID, LSID}`); **drop the 1h staleness window**; keep reactive phantom detection as the routability check | Round 2 — Q10=A |
| L1 wiring | Call RotateCookies **inside `ensureAuthenticated`**, best-effort; per-process in-memory 60s throttle; `sessionInvalid` flag removed | Round 2 — Q11=A |
| OpenSpec + SDK | **One GemiTerm OpenSpec change** now; `gemini-web-sdk` auth extraction as a **separate follow-up proposal** after GemiTerm proves the interface | Round 2 — Q12=C |
| SDK init() overwrite | AuthProvider **owns the jar** as source of truth; do NOT persist from `client.cookies` after `init()`; only merge PSIDTS rotation delta if SDK rotates it in-flight | Round 2 — Q13=A |

---

## 2. Architecture

### 2.1 Public surface: `AuthProvider`

```typescript
// src/auth/auth-provider.ts

interface LoginOptions {
  interactive?: boolean;    // true = headed browser, false = silent/refresh
  timeoutMs?: number;       // max wait for login
}

interface ProbeResult {
  state: "live" | "phantom" | "dead";
  models: number;           // model count (or -1 if failed)
  chats: number;            // chat count (or -1 if failed)
  error?: string;
}

interface CookieJarEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;          // unix epoch seconds
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None" | undefined;
}

interface AuthProvider {
  login(profileName: string, opts?: LoginOptions): Promise<void>;
  ensureAuthenticated(profileName?: string): Promise<CookieJarEntry[]>;
  probe(profileName: string): Promise<ProbeResult>;
}
```

**`ensureAuthenticated`** is the 95% call site — every command. It: loads stored cookies → runs L1 RotateCookies (best-effort) → returns the jar. No probe, no recovery ladder, no preemptive validation of dead sessions. It throws `AuthenticationError` only if the profile has zero stored cookies (i.e., never logged in).

**`login`** drives the headed/silent browser flow (current `playwright-cli` subprocess), captures a full jar, applies domain filtering, and stores atomically.

**`probe`** replaces the current `ProbeProfileQueryHandler`'s ad-hoc `models()`+`listChats()` calls. It constructs a throwaway SDK client with the profile's stored cookies and probes both endpoints. No side effects (no rotation, no persistence).

### 2.2 Internal collaborators (not public, injectable for testing)

```
AuthProviderImpl
  ├── CookieStore          (load / save / atomic-write / merge)
  ├── BrowserDriver        (playwright-cli subprocess wrapper)
  ├── SessionRefresher     (L1 RotateCookies POST + throttle)
  └── CookieValidator      (two-tier name-set preflight)
```

These are **not** separate public interfaces — they're implementation details of `AuthProviderImpl`. They're separate classes/files so they can be unit-tested independently (GemiTerm's existing `gimme(...)` DI pattern). The only public face the mediator sees is `AuthProvider`.

### 2.3 File layout

```
src/auth/
  index.ts                 re-exports AuthProvider interface
  auth-provider.ts         AuthProvider interface + AuthProviderImpl class
  cookie-store.ts          load / save / atomicWrite / merge, Playwright storage_state format
  browser-driver.ts        playwright-cli subprocess wrapper (refactored from services/)
  session-refresher.ts     L1 RotateCookies POST + 60s in-memory throttle + dedup
  cookie-validator.ts      two-tier preflight, domain filter constants
  types.ts                 CookieJarEntry, Profile, ProbeResult, LoginOptions
```

`index.ts` exports only: `AuthProvider` (interface), `AuthProviderImpl` (class), `LoginOptions`, `ProbeResult`, `CookieJarEntry`.

### 2.4 Data flow: `ensureAuthenticated`

```
ensureAuthenticated(profileName)
  │
  ├─ cookieStore.load(profileName)
  │    └─ if empty jar → throw AuthenticationError
  │
  ├─ sessionRefresher.rotate(profileName, cookies)   // L1, best-effort
  │    └─ POST accounts.google.com/RotateCookies
  │          body: [0,"-0000000000000000000"]
  │          └─ 200 + Set-Cookie headers → merge rotated PSIDTS/SIDCC into jar
  │          └─ non-200 → log debug, carry on (no throw, no sessionInvalid)
  │    └─ throttle: 60s per-profile in-memory, in-flight dedup
  │    └─ if rotation updated the jar → cookieStore.save(profileName, updated)
  │
  └─ return jar
```

### 2.5 Data flow: `login`

```
login(profileName, { interactive: true })
  │
  ├─ browserDriver.launch()            // playwright-cli subprocess
  ├─ browserDriver.navigate(geminiUrl) // open Gemini
  ├─ browserDriver.waitForLogin()      // poll for sign-out link
  ├─ cookies = browserDriver.capture() // context.storage_state() — FULL jar
  ├─ cookies = filterByDomain(cookies) // REQUIRED domains only
  │    └─ REQUIRED: .google.com, google.com, notebooklm.google.com, accounts.google.com ...
  │    └─ OPTIONAL: .youtube.com, docs.google.com, mail.google.com — NEVER persisted
  ├─ cookieStore.save(profileName, cookies)  // atomic write (temp + fsync + rename)
  └─ return
```

### 2.6 Data flow: `probe`

```
probe(profileName)
  │
  ├─ cookies = cookieStore.load(profileName)
  ├─ sdk = new Gemini({ secure1psid: cookies.psid })
  ├─ sdk.init()       // token-exchange (csrf/session scraping)
  ├─ models = sdk.models()
  ├─ chats = sdk.listChats({ limit: 1 })
  ├─ return { state: "live"|"phantom"|"dead", models: N, chats: N }
  └─ (SDK client is discarded — no persistence, no side effects)
```

---

## 3. notebooklm-py conceptual mirror

| notebooklm-py concept | TypeScript equivalent in `src/auth/` | Notes |
|---|---|---|
| `AuthTokens` dataclass (cookies + csrf + session) | n/a — csrf/session handled by SDK's `init()` | Simpler; SDK owns token scraping |
| `StoredAuthLoader.load()` | `AuthProvider.ensureAuthenticated()` | Single method, not a loader class |
| `browser_capture.run_browser_capture()` | `BrowserDriver` (refactored playwright-cli wrapper) | Keep existing driver; drop name filter |
| `cookie_policy._validate_required_cookies()` | `CookieValidator` (two-tier preflight) | Tier1: SID+1PSIDTS; Tier2: OSID or APISID+SAPISID+LSID |
| `keepalive._poke_session()` → RotateCookies | `SessionRefresher.rotate()` | L1 only; 60s in-memory throttle + in-flight dedup |
| `save_cookies_to_storage()` CAS merge | `CookieStore.save()` — atomic write (no CAS in v1) | Interface designed for CAS upgrade |
| `storage_state.json` (Playwright format) | Same format | Backward-compatible with existing profiles |
| `_atomic_io` (temp + fsync + rename) | `cookieStore.atomicWrite()` | Write temp → fsync → rename; no lock in v1 |
| `filter_storage_state_cookies_by_domain_policy()` | `filterByDomain(cookies)` in CookieValidator | REQUIRED/OPTIONAL domain tiers |
| `_validate_required_cookies` + `_has_valid_secondary_binding` | `CookieValidator.validate()` | Two-tier preflight |
| 7-rung recovery ladder | Deferred to v2 via `AuthProvider` interface extension | L2/L3/L4 added as additive methods later |
| `master_token.mint_cookies()` (OAuthLogin→MergeSession) | Deferred | L4, major feature |
| Reactive phantom detection | Existing `ListChatsQueryHandler` logic; rewire to call `authProvider.probe()` | Already on main |
| `LockUnavailableError` + cross-process filelock | Deferred to daemon proposal | No multi-process consumers in v1 |

---

## 4. Domain filtering constants

Mirroring notebooklm-py's `REQUIRED_COOKIE_DOMAINS` / `OPTIONAL_COOKIE_DOMAINS_BY_LABEL`:

```typescript
const REQUIRED_COOKIE_DOMAINS = [
  ".google.com", "google.com",
  "notebooklm.google.com", "notebook.google.com",
  "gemini.google.com",
  "accounts.google.com",
  ".googleusercontent.com",
];

const OPTIONAL_COOKIE_DOMAINS = [
  ".youtube.com",
  "docs.google.com",
  "mail.google.com",
  "myaccount.google.com",
];
```

These filter at **capture time** (what `playwright-cli`'s output is filtered by before persisting). OPTIONAL cookies carry Gmail/Drive/YouTube keys — irrelevant for Gemini API and dangerous to persist. If a future `listChats` requirement shifts, `REQUIRED_COOKIE_DOMAINS` is the single place to update — no scattered `REQUIRED_COOKIES` sets in `cookie-monitor.ts`, `cookie-rotation.ts`, or `auth-service.ts`.

---

## 5. Two-tier cookie preflight

```typescript
const TIER1_REQUIRED = new Set(["SID", "__Secure-1PSIDTS"]);
const TIER2_SECONDARY = new Set(["APISID", "SAPISID", "LSID"]);
const TIER2_ALT = new Set(["OSID"]);

function validate(cookies: CookieJarEntry[]): ValidationResult {
  const names = new Set(cookies.map(c => c.name));
  if (!Tier1.every(n => names.has(n))) return { valid: false, reason: "missing_tier1" };
  if (!(TIER2_ALT.every(n => names.has(n)) || TIER2_SECONDARY.every(n => names.has(n))))
    return { valid: false, reason: "missing_tier2" };
  return { valid: true };
}
```

Called on every `CookieStore.load()` — if the stored jar is incomplete, `ensureAuthenticated` skips L1 rotation (no point rotating a degraded jar) and throws `AuthenticationError` directing the user to re-login. The two-tier set is per notebooklm-py's three-way ablation (issue #1977). **Validation task:** verify which companions Gemini's `listChats` actually requires before locking the Tier2 set (run an ablation test: remove each companion, check `listChats` still works).

---

## 6. Implementation phases

### Phase 1: Foundation
**Files:** `src/auth/types.ts`, `src/auth/cookie-store.ts`, `src/auth/cookie-validator.ts`

- Define `CookieJarEntry`, `CookieJar`, `LoginOptions`, `ProbeResult`, `Profile` types
- Implement `CookieStore` — load/save/merge with atomic writes (temp + fsync + rename via `infrastructure/io.ts`). Format: Playwright `storage_state.json` (backward-compatible).
- Implement `CookieValidator` — two-tier preflight, domain filter constants.
- Tests: `tests/auth/cookie-store.test.ts`, `tests/auth/cookie-validator.test.ts`
- **No wiring changes yet** — these are pure utility classes.

### Phase 2: Browser driver
**Files:** `src/auth/browser-driver.ts`

- Refactor `src/services/playwright-cli-driver.ts` + `src/services/cookie-monitor.ts` into `BrowserDriver`.
- Remove the `REQUIRED_COOKIES` name-filter from `cookie-monitor.ts` — the driver returns the FULL jar.
- Move `cookie-monitor.ts`'s poll logic (sign-out probe, `SILENT_REFRESH_TIMEOUT_MS`) into the driver.
- Apply domain filtering (`filterByDomain`) on the captured jar.
- Tests: `tests/auth/browser-driver.test.ts` (port from existing `playwright-cli-driver.test.ts` + `cookie-monitor.test.ts`)

### Phase 3: Session refesher (L1 RotateCookies)
**Files:** `src/auth/session-refresher.ts`

- Extract RotateCookies logic from `src/services/cookie-rotation.ts`.
- Remove `sessionInvalid` flag — non-200 is "rotation declined, carry on" (debug log, no throw).
- Keep: POST body `[0,"-0000000000000000000"]`, `accounts.google.com/RotateCookies` endpoint.
- Keep: 60s per-profile in-memory throttle, in-flight dedup (from `a780788` design).
- Move `COOKIE_NAMES_OF_INTEREST` set here (internal implementation detail).
- Tests: `tests/auth/session-refresher.test.ts` (port from `cookie-rotation.test.ts`)

### Phase 4: AuthProvider integration
**Files:** `src/auth/auth-provider.ts`, `src/auth/index.ts`

- Define `AuthProvider` interface.
- Implement `AuthProviderImpl` composing CookieStore + BrowserDriver + SessionRefresher + CookieValidator.
- Wire `ensureAuthenticated`, `login`, `probe`.
- Rewire `src/cli/index.ts`: replace `ProfileAuthManager`/`AuthService` with `AuthProvider`.
  - `getGeminiClient` calls `authProvider.ensureAuthenticated(profile?)`.
  - `promptAndReauth` calls `authProvider.login(profile, {interactive:true})`.
  - `status` / `ProbeProfileQueryHandler` → calls `authProvider.probe(profile)` instead of constructing probe clients directly.
- Rewire reactive phantom detection in `ListChatsQueryHandler`: replace inline `models()` call with `authProvider.probe()`.
- Tests: `tests/auth/auth-provider.test.ts` (end-to-end at the provider seam)

### Phase 5: Remove old auth code
- Delete `src/services/auth-service.ts`, `profile-auth-manager.ts`, `cookie-monitor.ts`, `playwright-cli-driver.ts`, `cookie-rotation.ts`.
- Keep `src/services/cookie-storage-service.ts` as compatibility shim (delegate to `CookieStore`) until call sites migrate, then delete.
- Tests: remove old test files once new tests cover the same contracts.

### Phase 6: Regression gate
- Port the Phase 0 v2 regression ladder tests to the new `tests/auth/` module:
  - Capture-integrity (full jar flows through monitor)
  - Companion preservation (SID/HSID/SSID/APISID/SAPISID survive L1 rotation)
  - PSID rotation (L1 captures PSIDTS+PSID changes)
  - Targeted-only rotation (companion values unchanged after L1)
- Run full `bun test`; confirm baseline.

---

## 7. Migration

### Existing profiles
- `storage_state.json` format is unchanged — backward compatible.
- Profiles with 4-cookie trimmed jars (from pre-`6bc51f6` captures) will fail the two-tier preflight → `ensureAuthenticated` throws → user sees "Profile '<name>' has an incomplete cookie set. Run `gemiterm login` to re-authenticate."
- `status` PROBE column (`b1d0df0`) remains operational; rewire to call `authProvider.probe()`.

### Cutover
- New `src/auth/` module lands first; old `services/auth-*.ts` coexists during Phase 4.
- `cli/index.ts` wiring: swap old → new in one commit (Phase 4).
- Old files deleted in Phase 5 after all tests pass on the new wiring.
- `profile-auth-manager.test.ts` and `auth-service.test.ts` ported to `tests/auth/` before deletion.

### gemini-web-sdk coupling (Q13)
- `AuthProvider.ensureAuthenticated()` returns the jar; GemiTerm feeds `secure1psid` + `secure1psidts` to the SDK constructor.
- After SDK's `init()`, do NOT read `client.cookies` back for persistence. If the SDK rotates PSIDTS during `init()`, detect the delta by comparing pre/post values and merge ONLY the changed cookie back via `CookieStore.merge()` — not the full set.

---

## 8. Out of scope / deferred

| Item | Reason | Future trigger |
|------|--------|---------------|
| L2 background keepalive | Only matters for long-lived REPL/daemon; async scope | `gemiterm watch` or daemon proposal |
| L2.5 refresh-cmd (`NOTEBOOKLM_REFRESH_CMD`) | Niche operator hook | Operator demand |
| L3 headless reauth | Removed (`9762845`) — corrupted cookies via full mergeCookies; needs re-design | After L1 proves stable |
| L4 master-token (EmbeddedSetup → OAuthLogin → MergeSession) | Major feature, separate proposal | User demand for unattended auth |
| Snapshot/delta CAS merge (ADR-0029) | Only protects against long-lived-process stale-write; one-shot CLI doesn't trigger it | When daemon ships |
| Cross-process file locking | No multi-process consumers in v1; Windows `LockFileEx` equivalent non-trivial | When daemon ships |
| Domain-filter tier validation | REQUIRED domains listed are per notebooklm-py for Google NotebookLM; validate for Gemini | Ablation test (see §5) |
| `gemini-web-sdk` auth surface extraction | Separate repo, separate proposal | After `src/auth/` proves out in GemiTerm for one release |
| chrome-127+ App-Bound Encryption | Only relevant if switching to rookiepy browser-cookie extraction | If `playwright-cli` subprocess becomes unreliable |
| DBSC enforcement | notebooklm-py calls this the "documented endgame"; L3 CDP attach is the escape hatch | If Google blocks non-Chrome clients |

---

## 9. Risk register

| Risk | Mitigation |
|------|-----------|
| RotateCookies 401 returns after temp-banned | Best-effort carry-on (per Q2); SDK calls still work if cookies are valid for Gemini API |
| Companion cookies (SID/HSID/SSID) silently rotated server-side | Tier2 preflight catches disappearance at load time; reactive phantom detection catches "present but empty listChats" |
| `playwright-cli` subprocess breaking change | Driver is a single file; swapping to direct Playwright or CDP is a one-file change |
| Two-tier preflight rejects valid-but-different companion sets | Ablation test (§5) before locking Tier2 set |
| SDK init() doesn't return what AuthProvider captured (init overwrites cookies) | Q13: don't persist from client.cookies; AuthProvider's jar is source of truth |
| Existing on-disk 4-cookie jars from pre-fix captures | Two-tier preflight rejects them at load time → user gets "run gemiterm login" error message |

---

## 10. OpenSpec changes

**This plan maps to one `auth-provider-rewrite` OpenSpec change** (`openspec/changes/auth-provider-rewrite/`):

- **proposal.md** — this document (condensed)
- **design.md** — interface signatures, data flow diagrams, collabotor class sketches
- **tasks.md** — the 6 phases above as task items, each with test-gating

**Separate follow-up (after `auth-provider-rewrite` is implemented and proven):**

- `gemini-web-sdk-auth-api` — extract AuthProvider into the SDK repo as the SDK's first real auth surface
- `cas-cookie-store` — upgrade CookieStore to snapshot/delta CAS merge when a daemon ships
- `auth-ladder-l2-l3-l4` — implement the deferred recovery rungs

**Interaction with existing open changes:**
- `auth-daemon` (proposal-only, `f747fc6`) — superseded; daemon would use AuthProvider as-is
- `cookie-jar-integrity` (implemented, not archived) — superseded by the full-jar capture in Phases 2+4
- `phantom-auth-review-refactors` (no tasks done) — superseded; the existing auth files they'd refactor are being deleted
- `silent-refresh-stale-psidts-detection` — superseded; L2/L3 are deferred
