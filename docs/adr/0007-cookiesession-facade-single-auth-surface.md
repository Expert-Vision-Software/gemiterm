# CookieSession facade is the single auth surface (fix-1 cutover)

Auth had spread across `AuthService`, `CookieMonitor`, `CookieStorageService`, `ProfileAuthManager`, `cookie-rotation.ts`, and `GeminiClientService` persistence — the spread that produced the phantom saga. The fix-1 change (2026-08-16) cut over to one `CookieSession` deep module (`src/auth/cookie-session.ts`) exposing `ensureSession` / `captureLogin` / `probe` / `refresh` / `recover` / `findProfileForConversation` / `createKeepalive`, with all collaborators injected through a single deps-object. The old services were **deleted, not deprecated — do not resurrect them**.

## Consequences

- Nothing outside `src/auth/` imports the collaborators (store, validator, classifier, refresher, recovery); the facade exposes no raw collaborator accessors.
- The lifecycle doc (`docs/auth-cookie-lifecycle.md`) is this module's canonical design authority; its changelog is coupled to code changes by the gate (ADR-0009).
