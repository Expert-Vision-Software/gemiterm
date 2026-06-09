## 1. Create shared interactive prompt utility

- [ ] 1.1 Create `src/cli/utils/interactive-prompt.ts` module
- [ ] 1.2 Define `MessageHandler` callback interface for command-specific message processing
- [ ] 1.3 Implement `runInteractiveLoop` function that handles prompt loop mechanics
- [ ] 1.4 Ensure loop continues until /exit or /quit command
- [ ] 1.5 Handle empty input gracefully without sending

## 2. Refactor new-command.ts

- [ ] 2.1 Import the new `runInteractiveLoop` utility
- [ ] 2.2 Replace `startInteractive` method with call to `runInteractiveLoop`
- [ ] 2.3 Pass message handler callback that creates new chat conversations
- [ ] 2.4 Remove duplicated `startInteractive` method
- [ ] 2.5 Verify interactive mode loops correctly (not just one message)

## 3. Refactor continue-command.ts

- [ ] 3.1 Import the new `runInteractiveLoop` utility
- [ ] 3.2 Replace `startInteractive` method with call to `runInteractiveLoop`
- [ ] 3.3 Pass message handler callback that sends to existing conversation
- [ ] 3.4 Remove duplicated `startInteractive` method

## 4. Verify

- [ ] 4.1 Run `bun run test` to ensure all tests pass
- [ ] 4.2 Manually test `new` command interactive mode loops correctly
- [ ] 4.3 Manually test `continue` command interactive mode works correctly