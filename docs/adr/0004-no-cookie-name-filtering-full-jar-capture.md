# Full-jar capture; cookie-name filtering banned forever

Capture and persistence filter by **domain only** (`.google.com`, `.youtube.com`, `accounts.google.com`) and by nothing else. The gate that ends a login (both required cookies routable) is a condition, never the payload — the persisted jar is the complete browser storage state. All three capture-path bugs in the phantom ledger were name-subset filters (`REQUIRED_COOKIES`, `COOKIE_NAMES_OF_INTEREST`, `REFRESH_COOKIE_NAMES`), each correct for one purpose and silently wrong for another. Partial extraction is the #1 documented cause of "auth expires immediately".

## Consequences

- The 2026-08-15 ablation (PSIDTS is the only individually-required cookie; companions droppable) informs **validation gating only — never capture policy**. Do not "optimize" the jar down to the ablation's minimum.
- Cookie identity is `(name, domain, path)` — never name-only; the same name at `.youtube.com` is a different session, which is also why armed-SDK selection prefers the `gemini.google.com`-routable scope.
