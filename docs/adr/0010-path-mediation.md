# Path mediation: the filesystem is reachable only through exempted modules

`src/` files may not import `node:fs` / `node:path` / `node:os` except the exemptions in `scripts/lint-path-mediation.sh` (`infrastructure/path-utils.ts` for path values, `infrastructure/io.ts` for side effects, `chat-metadata-storage.ts`). The lint (`lint:mediation`) and CI enforce it.

## Why

Unmediated fs access scattered across auth code made cookie writes untestable, non-atomic, and un-auditable — exactly where the corruption bugs lived. Mediating every side effect through one io surface gives atomic writes, typed `IOError`s with `.cause`, and a single place to reason about concurrency (ADR-0006). The cost — indirection for every file touch — is deliberate friction.
