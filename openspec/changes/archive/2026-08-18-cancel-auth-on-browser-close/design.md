# Design: cancel-auth-on-browser-close

## D1 — Classifier placement

`isBrowserClosedError` lives on `PlaywrightCliDriver` because the markers are tied to `@playwright/cli` stderr text; classifying on `instanceof PlaywrightCliError` keeps the helper honest (won't match unrelated errors that happen to contain "not found").

## D2 — Why a new error type instead of reusing `LoginTimeoutError`

Cancellation is a user action, not a timeout. Sharing the type would force the CLI handler to string-match on the error message to decide exit code 0 vs 1. `LoginCancelledError` makes the contract explicit at the type seam and keeps `LoginTimeoutError`'s semantic ("we waited the full window") accurate.

## D3 — Why exit 0 on cancellation

The CLI contract treats uncaught errors as command failures (exit 1, stderr message). The user asked for cancellation, not failure. Exiting 0 with an info-level message matches the behavior of `gemiterm list -i` when the user picks `Exit`.

## D4 — No backoff or retry on classified error

The first `is not open` (or `not found`) is final. Retrying would race the user's intent (they may also be running `gemiterm login` for a different profile). One log, one error, immediate teardown.

## D5 — Classifier case-insensitivity

`@playwright/cli` sometimes prints `Browser '<name>' is not open` and sometimes prints lowercase variants depending on stderr encoding. Lowercasing both haystack and markers is cheap and avoids a future flare-up.

## D6 — Why the capture `finally` is unchanged

`closeSession` already swallows the `not found` teardown error. Re-pointing it at `isBrowserClosedError` extends coverage to `is not open` without changing the happy path. The `finally` runs on every throw, including the new `LoginCancelledError`.

## D7 — Auth-regression invariant rationale

`tests/auth-regression/invariant-capture-integrity.test.ts` extends the existing `signed-out capture safety` block with a cancellation scenario. The invariant is the strongest claim we can make about the fix:

1. The on-disk `storage_state.json` is byte-identical to before the failed capture.
2. `cookieListFromState` is never invoked.
3. `closeSession` is invoked exactly once with the correct profile name.
4. The facade rejects with `LoginCancelledError` (not `LoginTimeoutError`).