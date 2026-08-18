# GemiTerm — Agent Guide

Bun + TypeScript CLI for Google's Gemini web app. No API key — authenticates via a Playwright-driven browser. Multi-profile: `auth`/`login`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, `install-browser`, `install-skills`, `models`.

## Commands

```bash
bun install               # bun.lock is committed
bun run dev               # run the CLI
bun test --isolate        # full suite (record the pass/fail count in tasks.md when it moves)
bun test tests/<path>     # single file or dir, e.g. bun test tests/auth-regression
bun run typecheck         # tsc --noEmit — covers src/ ONLY (tests are excluded by tsconfig)
bun run lint:mediation    # path-mediation lint — use the bash form
bun run check:auth-gate   # auth-regression gate (auth-path diff without tests/auth-regression/ => fail)
bun run canary:auth       # mutation canary — requires a clean worktree
bun run build             # -> dist/gemiterm(.exe)
```

Gotchas:

- On Windows run the bash scripts via Git Bash (`C:\Program Files\Git\bin\bash.exe`), not WSL `bash.exe` (the WSL relay fails with `execvpe(/bin/bash)`). `bun run lint:mediation`, `check:auth-gate`, and `canary:auth` all invoke `bash`.
- `bun run lint:mediation:ps` is broken (hardcodes an old path) — always use the bash form. CI runs the bash form.
- `bun run typecheck` will NOT catch type errors in `tests/` (tsconfig `include` is `src/**` only). Verify test-only type errors by running the test file.
- `bun run test:parity` finds no test files. Real parity checks are `tests/parity/test-commands-parity.{sh,ps1}`, which diff against a Python `gemiterm` CLI on PATH (`GEMITERM_PYTHON_CLI`). Not run in CI.

## Architecture

```
src/cli/            entrypoint (index.ts) + one file per command + interactive utils
src/core/           types.ts + errors.ts only (no framework here)
src/auth/           CookieSession facade + store/validator/classifier/refresher/recovery
src/services/       Gemini client, export strategies, profile lifecycle, playwright/skills drivers
src/infrastructure/ config, io, logger, storage, cli-parser (commander), path-utils, formatters
```

No mediator. Dispatch: `src/cli/index.ts` -> `parseGlobalArgs` (`infrastructure/cli-parser.ts`, wraps `commander`) -> `CommandRegistry.getHandler` -> `handler.execute(args, context)`. Commands are plain classes registered in `command-registry.ts:registerAllCommands`.

`CliCommandContext` = `{ verbose, cookieSession, profileLifecycle, exportStrategies, getGeminiClient, listProfiles }` — this is what every command receives; don't invent new top-level wiring without adding it here and in `index.ts:setupServices`.

## Hard rules

### Path & file mediation
No `src/` file may import `node:fs` / `node:path` / `node:os` except the exemptions in `scripts/lint-path-mediation.sh`:
- `src/infrastructure/path-utils.ts` — path values
- `src/infrastructure/io.ts` — file-system side effects
- `src/services/chat-metadata-storage.ts`

Add new helpers to those modules; a new exemption must be added to the lint script + CI workflow with a reason. `io.ts` errors throw `IOError` (has `.cause`) — don't rethrow the raw `node:fs` error.

### Auth (highest-regression-risk area)
- The only auth surface is `src/auth/cookie-session.ts` (`CookieSession`), wired via `createCookieSession`. Nothing outside `src/auth/` imports the collaborators directly.
- **No cookie-name filtering, anywhere, ever** — capture/persistence filter by domain only (`filterToGeminiDomains`).
- **Auth-regression gate**: a change touching an auth-sensitive path (`AUTH_SENSITIVE_PATHS`, read by `scripts/check-auth-gate.{sh,ps1}`) must also touch `tests/auth-regression/` and append a `docs/auth-cookie-lifecycle.md` changelog entry, in the same change. Opt-out `SKIP_AUTH_REGRESSION_GATE=1` with a stated reason (audited). Warn-only in CI until flipped to blocking.
- **Docs authority order** (binding, `docs/README.md`): `docs/auth-cookie-lifecycle.md` (canonical) > `docs/cookie-ablation-findings.md` (empirical) > `docs/archive/**` (non-normative history) > everything else must not contradict. Resolve conflicts by rule, not judgment.
- Standing traps (don't re-litigate): never probe with the SDK's static `models()` table (use the init-GET + listChats classifier); cookie `expires` is meaningless for decay (server-side PSIDTS supersession is undetectable locally); no cookie-name filtering.
- **Sensitive driver surface (do not modify lightly)** — `src/services/playwright-cli-driver.ts` is regression-gated: `openHeaded` (persistent-profile argv WITH `--headed`), `openHeadless` (persistent-profile argv WITHOUT `--headed` — the headless rotation path), and `stateSave` (wraps the `state-save` subcommand). The only PSIDTS rotation engine is `src/auth/browser-refresher.ts` (headless persistent-profile page load → poll `cookie-list` → `state-save` → persist full jar). Deleted in the fix-1 cutover, do not resurrect: `src/services/{auth-service,cookie-monitor,cookie-storage-service,profile-auth-manager}.ts` (and their tests).
- **Hazard (do not drop this section)** — the sensitive-area doctrine above was deleted once by an unrelated docs commit (`67bc148`) and only caught by the 2026-08-17 audit; a docs-only change must never remove the playwright-cli-driver / rotation-engine / deleted-files guidance.

### Prompt facade
`src/cli/utils/prompts.ts` is the only module allowed to import `@inquirer/*`. All interactive I/O routes through it. `gemiterm list -i` is the only chat-list TUI entry point; non-interactive `list` output must stay byte-equivalent (regression => `tests/integration/commands/list.test.ts`).

## OpenSpec workflow

`openspec/` holds committed specs (`openspec/specs/`) and in-flight work (`openspec/changes/`). Use the `openspec-*` skills (propose / apply-change / sync-specs / archive-change). List `openspec/changes/` (excluding `archive/`) before proposing. Don't edit main specs directly — deltas flow from changes.

## Conventions

- Conventional commits; commit often; never push unless asked.
- Never comment out code — delete it (git remembers). Explanatory comments capture the *why* and link the governing spec/OpenSpec change.
- Run `bun test --isolate` (or the focused file) + `bun run typecheck` after non-trivial changes.
- Default to delegating to subagents (parallel for independent work, sequential when one feeds the next).
