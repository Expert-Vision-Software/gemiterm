# No mediator — commands dispatch directly to services

An earlier architecture routed command handling through a mediator layer. Change `2026-08-13-remove-mediator-layer` removed it: `src/cli/index.ts` → `parseGlobalArgs` (commander wrapper) → `CommandRegistry.getHandler` → `handler.execute(args, context)`, with shared wiring carried on `CliCommandContext` (cookieSession, profileLifecycle, exportStrategies, getGeminiClient, listProfiles) and composed once in `index.ts`.

## Why

The mediator was pure indirection — every new capability required touching a middle layer that added no behavior, and it was the second "spread" cleanup after the fix-1 auth consolidation. ProfileLifecycle later followed the same pattern (context-injected module replacing the service-locator idiom in `auth`/`status`). Do not reintroduce a middle layer without revisiting this decision.
