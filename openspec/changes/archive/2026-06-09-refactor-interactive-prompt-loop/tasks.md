## 1. Create shared interactive prompt utility

- [x] 1.1 Create `src/cli/utils/interactive-prompt.ts` module
- [x] 1.2 Define `MessageHandler` callback interface for command-specific message processing
- [x] 1.3 Implement `runInteractiveLoop` function that handles prompt loop mechanics
- [x] 1.4 Ensure loop continues until /exit or /quit command
- [x] 1.5 Handle empty input gracefully without sending

## 2. Refactor new-command.ts

- [x] 2.1 Import the new `runInteractiveLoop` utility
- [x] 2.2 Replace `startInteractive` method with call to `runInteractiveLoop`
- [x] 2.3 Pass message handler callback that creates new chat conversations
- [x] 2.4 Remove duplicated `startInteractive` method
- [x] 2.5 Verify interactive mode loops correctly (not just one message)

## 3. Refactor continue-command.ts

- [x] 3.1 Import the new `runInteractiveLoop` utility
- [x] 3.2 Replace `startInteractive` method with call to `runInteractiveLoop`
- [x] 3.3 Pass message handler callback that sends to existing conversation
- [x] 3.4 Remove duplicated `startInteractive` method

## 4. Verify

- [x] 4.1 Run `bun run test` to ensure all tests pass
- [x] 4.2 Manually test `new` command interactive mode loops correctly
- [x] 4.3 Manually test `continue` command interactive mode works correctly