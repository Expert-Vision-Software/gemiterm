# Browser cookie-scraping auth, no API key

Gemini's web app has no public API surface for what GemiTerm does (no OAuth scope, no service-account path, no API key), so the CLI authenticates by carrying Google session cookies obtained from a real browser sign-in on a persistent Chromium profile, replayed through `gemini-web-sdk`. Every project automating gemini.google.com works this way. This couples the whole CLI to Google's undocumented `batchexecute` wire and to browser-driven login — accepted deliberately, because the alternative is not existing as a product.

## Consequences

- Session validity is governed by server-side cookie rotation (see ADR-0003, ADR-0005), not by anything the CLI controls.
- Google can change the wire or enforce DBSC at any time; the escape hatch is the browser path itself (ADR-0002).
