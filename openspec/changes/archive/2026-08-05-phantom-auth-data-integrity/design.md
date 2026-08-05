## Context

`CookieStorageService.loadCookiesForProfile` builds a name-keyed `Map<string, string>` from the stored `Cookie[]` array. When the `.google.com` `__Secure-1PSIDTS` is absent (dropped by the L2 browser round-trip, per #13), the `.youtube.com` entry wins by insertion order and gets injected into the SDK. The SDK then sends a token-binding mismatch to `gemini.google.com`, which 200-OKs with an empty response — `[]`. Meanwhile, `AuthService.silentRefresh` calls `extractCookies` → `CookieStorage.save` which does a wholesale overwrite, so the 3-cookie polled set evicts the surviving `.google.com` PSIDTS. The codebase already has the correct pattern: `GeminiClientService.persistRefreshedCookies` does a value-keyed merge; it was just never applied to the `silentRefresh` path.

## Goals / Non-Goals

**Goals:**
- `loadCookiesForProfile` resolves `__Secure-1PSID` and `__Secure-1PSIDTS` to their `.google.com` domain entries when present
- `silentRefresh` persists polled cookies via upsert merge by `(name, domain, path)`, preserving entries the polled set doesn't carry
- The two red tests from `prototype/phantom-smoke-harness` (B1+B2 false-positive, B3 4→3 corruption) flip green

**Non-Goals:**
- Changing the probe itself (that's Proposal B)
- Changing `GeminiClientWrapper.persistRefreshedCookies` (it already merges correctly)
- Adding new `Clock` seams (deferred, not needed for data-integrity fixes)
- The `phantom-auth-review-refactors` cookie-constants extraction (unchanged by this proposal)

## Decisions

### Decision 1: Domain-scoped lookup vs. type-aware Cookie struct

`loadCookiesForProfile` currently does:
```ts
const map = new Map(cookies.map((c) => [c.name, c.value]));
```

**Chosen:** Filter for `.google.com` domain for each required cookie name before falling back to the first match:
```ts
function resolveCookie(cookies: Cookie[], name: string): string | undefined {
  const googleMatch = cookies.find(c => c.name === name && c.domain === ".google.com");
  return googleMatch?.value ?? cookies.find(c => c.name === name)?.value;
}
```

**Alternative considered:** Emit all domain variants as a `Map<string, string[]>` or add a `domain` field to `LoadedCookies`. Rejected — too invasive; the callers only ever use the `.google.com` values, and the fixed probe (Proposal B) needs exactly one resolved value.

### Decision 2: Merge-by-(name, domain, path) vs. merge-by-(name) in silentRefresh

The current code in `silentRefresh` (line 269):
```ts
await this.extractCookies(name, cookies); // wholesale overwrite
```

**Chosen:** Load the existing jar via `cookieStorageService.loadAllCookiesForProfile(name)`, upsert each polled cookie by `(name, domain, path)` key, save via `cookieStorageService.saveCookiesForProfile(name, merged)`. This reuses the `GeminiClientService.persistRefreshedCookies` pattern (`gemini-client-wrapper.ts:119-151`) which is already tested.

**Alternative considered:** Patch `CookieStorage.save` to merge internally. Rejected — `save` is a low-level I/O primitive with a clear contract (wholesale replace); merging is service-level logic.

### Decision 3: Cookie-monitor requireRotation prefers `.google.com` domain

`cookie-monitor.ts:164-165` finds PSID/PSIDTS by name only for the `requireRotation` baseline comparison. If the polled set has `.youtube.com` PSIDTS and the snapshot was built from `.google.com`, they'll always differ.

**Chosen:** Prefer `isGoogleDomainCookie` match in the `find()` calls when comparing against the snapshot. Consistent with how `auth-service.ts:261-264` already does the post-monitor comparison.

## Risks / Trade-offs

- [Risk] A profile with only `.youtube.com`-domain cookies (no `.google.com` entries) would lose its PSIDTS resolution → Mitigation: fallback to first match by name preserves backward compatibility.
- [Risk] Merge-by-`(name, domain, path)` introduces path-awareness; currently all cookies use `/` → Mitigation: path is `/` for all gemiterm-managed cookies; adding it is future-proofing, not a behavioral change.
