# Proposal: fix-1-cookie-session-core

Sequence: fix-1 of 3 (fix-2 `phantom-detection` and fix-3 `session-keepalive` build on this change). Evidence base: `docs/cookie-ablation-findings.md` (first-principles, raw-wire ablation on this codebase's target account) and `docs/auth-replacement-plan.md` (post-grilling settled decisions).

## Why

The phantom-auth bug (sessions decay during idle; `list` returns 0 chats or dead-init despite locally-valid cookies) has recurred through every release since v2.4.0 because the codebase never rotated `__Secure-1PSIDTS`. The 2026-08-15 ablation proved: jar *shape* was never the dormancy mechanism (the trimmed 4-cookie jar works when fresh; dropping any cookie except `__Secure-1PSIDTS` is survivable); server-side PSIDTS *supersession* is. It further proved that live RPC/init traffic never rotates PSIDTS, that HTTP `RotateCookies` withholds PSIDTS minting on this account (4/4 attempts, live and dead), and that a headless browser page-load on the persistent profile is the only working rotation engine - it resurrected a 9-hour-dead session end-to-end. The current auth code (`AuthService` + `CookieMonitor` + `CookieStorageService` + `ProfileAuthManager`) is scattered across five modules, embodies the name-filtering anti-pattern that caused three ledger bugs, and has no rotation at all.

## What Changes

- New `src/auth/` module with a single public `CookieSession` facade (`ensureSession`, `captureLogin`, `probe`, `refresh`) composed of injected collaborators (`BrowserRefresher`, `CookieStore`, `CookieValidator`, recovery rung) via a deps-object, mirroring `teng-lin/notebooklm-py`'s auth architecture.
- **Capture**: full browser jar via `playwright-cli state-save`, domain-filtered (`.google.com`, `.youtube.com`, `accounts.google.com`); cookie-name filtering is structurally removed. The login gate (poll until `__Secure-1PSID` + `__Secure-1PSIDTS` present) is separated from the payload (the complete jar) - the H6 lesson made structural.
- **Refresh engine**: `BrowserRefresher` opens a *headless* persistent-profile page load, polls until the PSIDTS value differs from the on-disk baseline (or 60 s timeout), captures via `state-save`, persists via CAS. Fires (a) detached/opportunistically when a command arms on a jar whose mtime exceeds 30 minutes, and (b) synchronously as the L3 recovery rung.
- **Storage**: `CookieStore` with snapshot/delta compare-and-swap saves (stale-overwrite-fresh prevention) plus one cross-process lock file per profile, implemented purely with Bun `node:fs` exclusive-create semantics - no shell commands, no `flock`, identical behavior on Windows/POSIX and under any shell.
- **Validation**: tier-1 raises when `__Secure-1PSIDTS` is not RFC-6265-routable to `gemini.google.com` or `__Secure-1PSID` is absent; tier-2 warns once when the companion set (`SID`/`HSID`/`SSID`/`APISID`/`SAPISID`/`SIDCC`/`NID`) is absent.
- **Classifier**: read-only `probe` classifies a profile as `live` / `phantom` / `dead` via the init-token check plus `listChats({limit:1})`. The SDK's `models()` (a static table, no network) MUST NOT be used as a probe.
- `PlaywrightCliDriver` gains `openHeadless`, `stateSave`, and session-close surface extensions (sensitive area; `tests/services/playwright-cli-driver.test.ts` updated per AGENTS.md).
- Legacy auth services (`src/services/auth-service.ts`, `cookie-monitor.ts`, `cookie-storage-service.ts`, `profile-auth-manager.ts`) are deleted; their live consumers are rewired to the facade. `GeminiClientService` keeps its existing 2-cookie SDK construction surface (ablation-validated as sufficient), now fed from the facade-armed jar.
- HTTP `RotateCookies` is intentionally omitted (proven void for PSIDTS on this account; wire documented in `docs/cookie-ablation-findings.md` for a hypothetical future L4).

## Capabilities

### New Capabilities

_(none - all new behavior lands in the existing `auth` capability)_

### Modified Capabilities

- `auth`: removes the `AuthService`/`CookieMonitor`/`CookieStorageService`/`ProfileAuthManager` requirement set (13 requirements; classes deleted) and adds the `CookieSession` facade, full-jar capture, browser-backed refresh engine, CAS store + cross-process lock, two-tier validation, read-only session classifier, L3 recovery rung, and the driver's headless/storage-state surface.

## Impact

- **Code**: new `src/auth/{cookie-session,browser-refresher,cookie-store,cookie-validation,session-classifier,recovery,refresh-runner}.ts`; `src/services/playwright-cli-driver.ts` (extensions, sensitive area); `src/cli/index.ts` + `src/cli/command-registry.ts` (context wiring swaps `ProfileAuthManager` for `CookieSession`); `src/services/gemini-client-wrapper.ts` (cookie-source swap only); `src/services/profile-lifecycle.ts` (login action delegates to `captureLogin`). Deleted: `src/services/{auth-service,cookie-monitor,cookie-storage-service,profile-auth-manager}.ts` and their `infrastructure/storage.ts` cookie-validation duplication.
- **Not changed**: CLI command surface and non-interactive output bytes, on-disk `storage_state.json` format (Playwright storage state - existing profiles migrate transparently; legacy 2/4-cookie jars self-upgrade via the detached refresh), profile directory layout, prompt layer.
- **Tests**: baseline 862 pass / 2 skip / 0 fail / 1748 expects / 56 files must hold (new tests added; deleted-service tests removed; net count recorded in tasks). Gates: `bun run typecheck`, `bun run lint:mediation` (bash form), `tests/services/playwright-cli-driver.test.ts` re-read before committing, `tests/integration/commands/list.test.ts` byte-equivalence intact.
- **Docs**: AGENTS.md sensitive-area section rewritten for the new auth surface; `docs/phantom-bug-synthesis.md` ledger entry appended at implementation time.
- **Dependencies**: none added (`playwright-cli` subprocess retained via existing `@playwright/cli` resolution).
