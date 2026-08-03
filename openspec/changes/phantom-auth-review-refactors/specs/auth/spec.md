## ADDED Requirements

### Requirement: Cookie-name identifiers have a single source of truth

The system MUST provide a shared module (`src/core/cookie-constants.ts`)
that exports the canonical string constants for Gemini auth cookie names
(`__Secure-1PSID`, `__Secure-1PSIDTS`), the `REQUIRED_COOKIE_NAMES` set,
the `CookieBaseline` interface (`{ activePsid: string; activePsidts:
string | null }`), and the `cookiesRotatedFrom(baseline, polled)` helper.
No file in `src/services/` or `src/infrastructure/` MAY use bare
`"__Secure-1PSID"` or `"__Secure-1PSIDTS"` string literals; all
references MUST import from `cookie-constants.ts`.

#### Scenario: No bare cookie-name literals in src/services/

- **WHEN** `rg '"__Secure-1PSID"' src/services/` is run after the
  refactoring
- **THEN** zero matches are returned (all references use the imported
  constant)
- **AND** the same holds for `"__Secure-1PSIDTS"`

#### Scenario: cookiesRotatedFrom returns true when PSIDTS differs

- **WHEN** `cookiesRotatedFrom({ activePsid: "old", activePsidts: "old-ts" }, [{ name: "__Secure-1PSID", value: "old", domain: ".google.com", ... }, { name: "__Secure-1PSIDTS", value: "new-ts", domain: ".google.com", ... }])` is called
- **THEN** the result is `true`

#### Scenario: cookiesRotatedFrom returns false when both match baseline

- **WHEN** `cookiesRotatedFrom({ activePsid: "same", activePsidts: "same-ts" }, [{ name: "__Secure-1PSID", value: "same", domain: ".google.com", ... }, { name: "__Secure-1PSIDTS", value: "same-ts", domain: ".google.com", ... }])` is called
- **THEN** the result is `false`
