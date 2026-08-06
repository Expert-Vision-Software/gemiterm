## ADDED Requirements

### Requirement: Auth rotation is safe to invoke from a concurrent background daemon process
The `rotateCookies` function from `src/services/cookie-rotation.ts`, the `mergeCookies` upsert in `src/services/auth-service.ts:20-30`, and the `persistRefreshedCookies` `(name, baselineValue)` merge in `src/services/gemini-client-wrapper.ts:119-151` together constitute the per-profile cookie-rotation contract. When a `gemiterm` CLI process and a separately-running `gemiterm daemon` process both invoke `rotateCookies` for the same profile within the 600 s disk-mtime guard window, exactly one HTTP request to `accounts.google.com/RotateCookies` is issued across both processes; the second invocation MUST short-circuit via the disk-mtime guard and MUST NOT issue a conflicting network request. When both processes write to the cookie storage concurrently, the `mergeCookies` upsert MUST preserve entries not present in the polled/refreshed set and MUST NOT evict a still-valid `.google.com` `__Secure-1PSIDTS` in favor of a stale value from a competing process. The background daemon MUST NOT introduce any new locking mechanism; the existing per-file mtime guard and the upsert merge are the entire contract.

#### Scenario: Concurrent CLI + daemon rotations are deduplicated by the mtime guard
- **WHEN** a `gemiterm list` CLI invocation calls `rotateCookies` for profile `default` at the same wall-clock instant the `gemiterm daemon` process is rotating the same profile
- **THEN** exactly one of the two processes issues the HTTP `RotateCookies` POST; the other process observes the storage_state.json mtime has been updated within the 600 s guard window and returns early without a network request

#### Scenario: Concurrent writes preserve still-valid cookies via the merge upsert
- **WHEN** the daemon process writes a fresh `__Secure-1PSIDTS` for `.google.com` on profile `default` at the same instant the CLI process is reading cookies and about to write a refresh from a separate poll
- **THEN** the `.google.com` `__Secure-1PSIDTS` is whichever value was written first; the second writer's `mergeCookies` upsert does NOT evict the surviving `.google.com` value because the `mergeCookies` upsert preserves entries the polled set does not carry

#### Scenario: No new locking primitives are introduced for daemon coexistence
- **WHEN** the background daemon capability is enabled
- **THEN** the `rotateCookies` function, the `CookieStorage` write paths, and the `persistRefreshedCookies` merge remain the entire contract — no advisory locks, no file mutexes, no flock calls are added to support daemon coexistence
