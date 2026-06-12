## 1. List command: drop default 10-cap

- [x] 1.1 Change `DEFAULT_OPTIONS.limit` from `10` to `0` in `src/cli/commands/list-command.ts`.
- [x] 1.2 In `execute`, compute `hasLimit = options.limit > 0` and use it to drive both the mediator payload (`limit: hasLimit ? options.limit : undefined`) and the client-side slice (`if (hasLimit) chats = chats.slice(offset, offset + limit); else if (offset > 0) chats = chats.slice(offset);`).
- [x] 1.3 Remove the `all: boolean` field from `ListCommandOptions` and `DEFAULT_OPTIONS` (no longer needed; omitting `--limit` is the same as the old `--all`).
- [x] 1.4 Remove the `case "--all":` branch from `parseArgs`.
- [x] 1.5 Remove the `--all` entry from the `showUsage` flags array; update the `--limit` description to `Limit number of results (no limit by default)`.

## 2. List command: update tests

- [x] 2.1 In `tests/cli/list-command.test.ts`, replace the `applies --all flag` test with two: `returns all conversations by default (no limit)` (asserts `Total: 3 conversations` and `payload.limit === undefined`) and `applies --limit to restrict results` (asserts `Total: 1 conversation` and `payload.limit === 1`).
- [x] 2.2 In `tests/integration/commands/list.test.ts`, replace the `--all flag` block with a `default limit behaviour` block: `omitting --limit sends query without limit` and `--limit N sends N as limit`.

## 3. Browser prompt: title truncation

- [x] 3.1 In `src/cli/utils/prompts.ts`, add a module-scoped `const TITLE_MAX = 55;` and an exported `function truncateTitle(title: string): string` that returns the title unchanged when `length <= 55` and `title.slice(0, 54) + "…"` otherwise.
- [x] 3.2 In the browser prompt's `renderItem` callback, replace `const title = item.title;` with `const title = truncateTitle(item.title);`.
- [x] 3.3 Add four unit tests in `tests/cli/utils/chat-list-browser.test.ts` for `truncateTitle` (short, exactly-55, 80-char, 56-char edge) and one integration test that renders an 80-char title and asserts the screen contains the truncated prefix (`a` × 54) and the ellipsis (`…`).

## 4. Quality gates

- [x] 4.1 Run `bun run typecheck` and confirm zero errors.
- [x] 4.2 Run `bun test` and confirm 0 fail (baseline 664/0/1318).
- [x] 4.3 Verify the `commands` and `chat-list-browser` delta specs in this change describe the new behavior accurately.
