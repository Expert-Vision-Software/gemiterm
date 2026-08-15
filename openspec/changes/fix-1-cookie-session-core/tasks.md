# Tasks: fix-1-cookie-session-core

Baseline: `bun test` -> 862 pass / 2 skip / 0 fail / 1748 expects / 56 files. Run `bun run typecheck` after each group; run `bun run lint:mediation` (bash form) after groups touching `src/infrastructure/`; re-read `tests/services/playwright-cli-driver.test.ts` before any commit touching the driver (AGENTS.md sensitive area). Conventional commits per group; never push.

## 1. Driver extensions (sensitive area, additive only)

- [ ] 1.1 Add `openHeadless(url, profile, session?)` to `PlaywrightCliDriver` - same argv builder as `buildOpenHeadedArgs` minus the `--headed` flag; add `stateSave(session, outputPath)` wrapping `state-save <file>`; expose session `close(session)` via the existing `closeSession` path; extend `buildOpenHeadedArgs` consumers only where needed
- [ ] 1.2 Extend `tests/services/playwright-cli-driver.test.ts` with argv-shape tests for the new methods (headless open has no `--headed`; `state-save` receives the target path); confirm existing driver tests unchanged

## 2. CookieStore (CAS + lock, pure Bun fs)

- [ ] 2.1 Create `src/auth/cookie-store.ts`: `load(profile)` returns cookies + snapshot (`(name,domain,path) -> value`); `save(profile, cookies, snapshot)` writes only deltas whose on-disk value still matches the snapshot; atomic temp-file write via `io.ts` surface
- [ ] 2.2 Implement the lock: sibling `storage_state.json.lock`, exclusive-create (`wx`) acquisition, 100 ms retry; CAS saves wait <= 10 s then proceed (fail-open); full-jar writers wait <= 90 s then throw `LockUnavailableError` (fail-closed, typed, exported from `src/core/errors.ts`); locks with mtime older than 120 s are stealable; no shell commands anywhere
- [ ] 2.3 RED-first tests: CAS prevents stale-overwrite-fresh (second writer with stale snapshot does not clobber a fresher on-disk value it did not change); lock contention fail-open/fail-closed paths; stale-lock steal; Windows-safe (tests run on `bun test` locally on Windows)

## 3. Validation + classifier

- [ ] 3.1 Create `src/auth/cookie-validation.ts`: tier-1 raise (`__Secure-1PSIDTS` RFC-6265-routable to `gemini.google.com` AND `__Secure-1PSID` present) with typed error; tier-2 warn-once (companion set `SID`/`HSID`/`SSID`/`APISID`/`SAPISID`/`SIDCC`/`NID` absent); implement the routability predicate (domain/path/expiry selection against the target URL)
- [ ] 3.2 Create `src/auth/session-classifier.ts`: `classify(profile)` -> `live | phantom | dead` via init GET token check (`SNlM0e`/`cfb2h`/`FdrFJe` present) + `listChats({limit:1})`; read-only (no writes, no refresh); no use of SDK `models()` anywhere
- [ ] 3.3 RED-first tests: tier-1 raises on missing and on present-but-unroutable PSIDTS (wrong-domain-scope variant included); tier-2 warns exactly once; classifier maps tokens+chats->live, tokens+0->phantom, no-tokens->dead (fakes at the HTTP seam)

## 4. BrowserRefresher + refresh-runner (the rotation engine)

- [ ] 4.1 Create `src/auth/browser-refresher.ts`: `rotatePsidts(profile, baselineValue, timeoutMs=60_000)` - headless `open --persistent --profile`, poll `cookie-list` until `__Secure-1PSIDTS` value differs from baseline or timeout, `state-save` to the profile's storage path via full-jar writer, close session in `finally`; domain filter (`.google.com`, `.youtube.com`, `accounts.google.com`) applied to the captured jar
- [ ] 4.2 Create `src/auth/refresh-runner.ts`: standalone Bun entry point taking a profile name; runs the refresher with the on-disk PSIDTS as baseline; never prompts, never throws user-visible; idempotent; logs rotation outcome
- [ ] 4.3 RED-first tests: refresher persists only on PSIDTS change (no spurious writes); timeout path closes the browser and reports `rotated:false`; captured jar keeps companions (regression pin for the H6/full-jar contract); domain filter keeps `.google.com`/`.youtube.com`/`accounts.google.com` rows only

## 5. CookieSession facade + recovery

- [ ] 5.1 Create `src/auth/cookie-session.ts`: `ensureSession(profile)` (load -> tier validation -> arm; if jar mtime > 30 min, spawn detached `refresh-runner`; return armed cookies), `captureLogin(profile)` (headed open -> gate poll on PSID+PSIDTS presence -> full-jar `state-save` payload -> persist via full-jar writer -> expiry computed from PSIDTS), `probe(profile)` (delegate to classifier), `refresh(profile)` (synchronous refresher); deps-object `CookieSessionDeps` with all collaborators injectable
- [ ] 5.2 Create `src/auth/recovery.ts`: refresh-and-retry-once rung (synchronous refresh -> CAS persist -> re-arm once -> `AuthenticationError` on failure), typed and exported for fix-2 wiring
- [ ] 5.3 RED-first tests: facade arms from disk with zero network calls in the fresh path (gate: no refresher/classifier invocation when jar is fresh); stale-mtime path spawns the detached runner exactly once; captureLogin gate-is-not-payload (callback payload contains cookies beyond the gate set); recovery retries exactly once then throws

## 6. Cutover wiring + legacy deletion

- [ ] 6.1 Rewire `src/cli/index.ts` + `src/cli/command-registry.ts`: replace `ProfileAuthManager` on the context with `CookieSession`; update `getGeminiClient` construction to arm via `ensureSession`; keep `GeminiClientService`'s 2-cookie construction untouched
- [ ] 6.2 Rewire `src/services/profile-lifecycle.ts` login/create actions to `captureLogin`; preserve all existing menu flows, prompts, and output text (auth command requirements in the `auth` spec must stay green)
- [ ] 6.3 Replace `findProfileForConversation`/active-profiles consumers with facade equivalents (classifier-backed `activeProfiles`, unchanged conversation-routing semantics)
- [ ] 6.4 Delete `src/services/{auth-service,cookie-monitor,cookie-storage-service,profile-auth-manager}.ts`; delete their test files; remove the duplicated `COOKIE_EXPIRY_THRESHOLD_MS` copies from `gemini-client-wrapper.ts` and `infrastructure/storage.ts` where now dead
- [ ] 6.5 Update AGENTS.md sensitive-area section: document `src/auth/` as the auth surface, the playwright-cli headless/state-save methods, and the deleted-files list

## 7. Regression pins + verification

- [ ] 7.1 Port the full-jar contract pins: no cookie-name filtering anywhere under `src/auth/` (greppable rule: no `REQUIRED_COOKIES`/`COOKIE_NAMES_OF_INTEREST`-style sets); capture payload preserves companions
- [ ] 7.2 Full suite green with net test count recorded here (baseline 862/2/0/1748 - expect net-positive from new pins, net-negative from deleted-service tests); `bun run typecheck` clean; `bun run lint:mediation` clean
- [ ] 7.3 `tests/integration/commands/list.test.ts` byte-equivalence green (non-interactive `list` output unchanged)
- [ ] 7.4 Live verification (user-assisted): fresh `gemiterm auth` capture yields a full-domain-filtered jar (~40 cookies); `gemiterm list` works; idle > 1 h then `gemiterm list` still returns chats (the phantom-bug kill test - historically fails within ~1 h 15 m); request a freshly authenticated profile from the user at this step
- [ ] 7.5 Append the implementation entry to `docs/phantom-bug-synthesis.md` (write-once ledger convention)
