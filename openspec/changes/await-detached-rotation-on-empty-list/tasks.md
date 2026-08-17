## 1. Facade (auth)

- [x] 1.1 Record `{ psidts, stale }` at arm time in `ensureSession`; add `rotationWaitMs` (default 30 000) to `CookieSessionDeps`
- [x] 1.2 Implement `waitForRotation(profile, opts?)` (immediate-first poll, bounded timeout, passive, never throws) and `rotationInFlight(profile)` on `CookieSession`

## 2. Command layer

- [x] 2.1 Add the rotation-await stage to `ListCommand.resolvePhantomEmptyResult`: stderr notice, bounded wait, single retry on success, timeout hint on `null` — before the classification stage; stdout untouched

## 3. Tests

- [x] 3.1 Extend `tests/integration/commands/list.test.ts`: wait-then-retry renders retried chats; timeout falls through to the existing probe flow; the shared mock gains no-op `waitForRotation`/`rotationInFlight` so existing tests stay green
- [x] 3.2 Add `tests/auth-regression/invariant-await-rotation.test.ts` driving the real `CookieSession` + `CookieStore`: fresh-arm short-circuit, rotation-observed re-arm, timeout null, passivity (no spawn/write during wait)

## 4. Docs + verification

- [x] 4.1 Append the changelog entry to `docs/auth-cookie-lifecycle.md`
- [x] 4.2 Run `bun test tests/integration/commands/list.test.ts`, `bun test tests/auth-regression`, `bun test --isolate`, `bun run typecheck`, `bun run lint:mediation`, `bun run check:auth-gate` (Git Bash); record the pass/fail count here if it moves

  Results: full suite 946 pass / 0 fail / 2 skip (was 941 pass / 2 skip before this change — +5 tests); typecheck clean; path-mediation lint OK; auth gate PASS (covered by `tests/auth-regression/invariant-await-rotation.test.ts`). Red-capability proven by stashing `src/` (7 failures) vs green with the fix.

## 5. Field verification (manual, user-gated)

- [ ] 5.1 Fresh login → `list` OK → idle ≥ 1h15m → single `gemiterm list` waits, then renders conversations; quick re-run shows no second-runner flashes in the common case
