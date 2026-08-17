---
description: Rotate PSIDTS cookies for Gemini profile(s) by opening each profile's persistent Chromium user-data dir, letting the page run its own JS rotation, exporting the rotated jar, and overwriting the stale storage_state.json beside it.
subtask: true
---

# Rotate profile auth

Refresh the `__Secure-1PSIDTS` cookie for one or more Gemini profiles. The fix runs a real browser against the profile's persistent user-data directory so Google's identity surface sees a familiar device and the page's own JavaScript performs the rotation that raw HTTP cannot coax.

## Input

`$ARGUMENTS` is exactly one of:

- A profile directory name (e.g., `dhb-zeek`) — resolved under `.gemiterm/profiles`
- An absolute or relative path to a single profile directory (a Chromium user-data dir containing `Default/` and `storage_state.json`)
- An absolute or relative path to a directory containing one or more profile subdirectories

The path forms may use forward or backslashes. Resolve it to an absolute Windows path first.

**Disambiguate single profile vs. directory of profiles.** If the resolved path itself contains a `Default/` subdirectory and a `storage_state.json`, treat it as a single profile. Otherwise enumerate the immediate subdirectories and treat each one as a profile. Skip any subdirectory that does not look like a Chromium user-data dir (no `Default/` or no `storage_state.json`) and record it as skipped.

## Steps per profile

For each resolved profile directory `<P>` and a session label `<S>` derived from `<basename(P)>-<short-timestamp>`:

1. Confirm `<P>/Default/` and `<P>/storage_state.json` exist. If not, skip with a warning.

2. Make sure `.gemiterm/harness/` exists in the repo CWD (create with `New-Item -ItemType Directory -Path .gemiterm/harness -Force` if missing).

3. Open the profile against Gemini:
   ```bash
   bunx @playwright/cli -s=<S> open --browser=chromium --persistent --profile="<abs-P>" https://gemini.google.com/app
   ```
   Run this from the repo CWD. If `open` fails, do not run the remaining steps for this profile — record the error and continue with the next.

4. Wait ~12 s for the page's JS to rotate `__Secure-1PSIDTS`:
   ```bash
   sleep 12
   ```

5. Export the rotated jar and close the browser:
   ```bash
   bunx @playwright/cli -s=<S> state-save .gemiterm/harness/<S>-recovered.json
   bunx @playwright/cli -s=<S> close
   ```
   Capture the console error count from the `state-save` output. Transient console errors are tolerable — note the count but do not abort.

6. Overwrite the stale snapshot with the rotated one:
   ```bash
   Copy-Item -Path ".gemiterm\harness\<S>-recovered.json" -Destination "<P>\storage_state.json" -Force
   ```
   PowerShell `Copy-Item -Force` overwrites silently.

7. Record the outcome for this profile: open ok/fail, export ok/fail, copy ok/fail, console error count.

## After all profiles

Emit a single status table back to the user:

```
## Rotate profile auth

| Profile    | Open | Wait | Export | Copy | Console errors |
| ---------- | ---- | ---- | ------ | ---- | -------------- |
| dhb-zeek   | ok   | 12s  | ok     | ok   | 0              |
| dhb-worker | ok   | 12s  | ok     | ok   | 10 (transient) |

N/M profiles refreshed. K skipped (not Chromium user-data dirs).
```

Do not run `bun run dev list` automatically — that is the user's separate verification step.