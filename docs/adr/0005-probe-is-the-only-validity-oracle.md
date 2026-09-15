# Cookie `expires` is meaningless; the probe classifier is the only validity oracle

A jar that looks a year fresh can already be dead: PSIDTS supersession is server-side and undetectable locally. Therefore local freshness (the 7-day status-table heuristic) is display-only metadata and must never drive recovery, re-auth, or error paths; the read-only probe (init-GET token extraction by value + listChats count → live/phantom/dead) is the only sanctioned session-state oracle. Detection is **reactive only** — nothing local predicts decay, and preemptive probing proved actively harmful when its verdict triggered destructive recovery (two ledger episodes).

## Standing traps (each with scar tissue — do not re-litigate)

- `models()` in gemini-web-sdk is a **static table, zero network** — the historical "models probe" unknowingly only re-ran the init GET. Probes must be an init GET or a real RPC.
- A `RotateCookies` 401 is not session death; a 200-with-no-PSIDTS is not health. It is a rotation endpoint, not a probe — treating it as either killed valid sessions (ledger 2026-08-06, 2026-08-09).
- Empty-valued init token keys (`"cfb2h":""`) mean signed-out HTML → dead. Token presence is decided by value extraction, not key presence.
