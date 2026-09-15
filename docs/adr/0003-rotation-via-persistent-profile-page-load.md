# PSIDTS rotation via headless page load on the persistent profile; scheduling over a resident daemon

The 2026-08-15 ablation proved the phantom-session bug's root cause is server-side `__Secure-1PSIDTS` supersession under zero rotation, and that Google's HTTP `RotateCookies` endpoint **withholds** PSIDTS on the tested account (4/4 attempts — 200, SIDCC minted, PSIDTS never). The only proven rotation engine is a page load on the persistent Chromium profile, which runs Google's own page JS: headless open → poll → `state-save` → close, short-lived per refresh (never a resident browser). `src/auth/browser-refresher.ts` is the only rotation engine.

## Considered Options

- **HTTP `RotateCookies` as primary engine**: dead on this account; kept only as a planned cheap supplement (SIDCC refresh, `hfcr` readout). Re-verify periodically — if PSIDTS mint returns, the ladder flips (see lifecycle doc §9 canaries).
- **Resident auth daemon**: the OpenSpec `auth-daemon` proposal (`f747fc6`) was deliberately reframed as OS-scheduled one-shot refresh (cron/Task Scheduler firing the L3 unit every 15–20 min, off-minute) + L3 on-demand. A resident daemon multiplies failure modes ("daemon died", sleep/resume, autostart) for a single-process CLI.

## Consequences

- The profile directory doubles as the persistent browser user-data dir — device continuity is the bot-detection shield. Never write the browser DB by hand; refresh it only by loading pages.
- Session names must be caller-scoped (`refresh-<profile>`, `recover-<profile>`): closing a shared name kills the other caller's browser mid-poll.
