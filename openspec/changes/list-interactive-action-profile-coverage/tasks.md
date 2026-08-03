## 1. Add regression tests

All tests go inside the existing `describe("action menu (single-pick dispatch)")` block in `tests/cli/list-command.test.ts`, alongside the existing `"view forwards the selected chat profile to fetch"` test. Each test follows the same pattern: set a chat with `profile: "<name>"`, select the action, and assert the mock was called with the expected argv including `--profile <name>`.

- [ ] 1.1 Add `"export-markdown forwards --profile to export"` test — chat with `profile: "dhb-worker"`, select `"export-markdown"`, assert `exportExecute` called with `[chat.id, "--format", "markdown", "--out", "<path>", "--profile", "dhb-worker"]`
- [ ] 1.2 Add `"export-json forwards --profile to export"` test — chat with `profile: "personal"`, select `"export-json"`, assert `exportExecute` called with `[chat.id, "--format", "json", "--out", "<path>", "--profile", "personal"]`
- [ ] 1.3 Add `"continue forwards --profile to continue"` test — chat with `profile: "work"`, select `"continue"`, assert `continueExecute` called with `[chat.id, "--profile", "work"]`
- [ ] 1.4 Add `"delete forwards --profile to delete"` test — chat with `profile: "dhb-worker"`, select `"delete"`, assert `deleteExecute` called with `[chat.id, "--force", "--profile", "dhb-worker"]`

## 2. Verify

- [ ] 2.1 Run `bun test tests/cli/list-command.test.ts` — all tests pass
- [ ] 2.2 Run `bun run typecheck` — clean
