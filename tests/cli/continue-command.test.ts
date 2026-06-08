import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ContinueCommand } from "../../src/cli/commands/continue-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { COMMAND_TYPES } from "../../src/core/command-handlers.ts";
import { QUERY_TYPES } from "../../src/core/query-handlers.ts";

describe("ContinueCommand", () => {
  let command: ContinueCommand;
  let mediator: Mediator;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ContinueCommand();
    mediator = new Mediator();
    context = {
      verbose: false,
      mediator,
      profileAuthManager: {
        getActiveProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["profileAuthManager"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("continue");
    expect(command.description).toBe("Continue a conversation");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm continue");
    expect(output).toContain("conversation_id");
    expect(output).toContain("/exit");
  });

  test("shows help with -h flag", async () => {
    await command.execute(["-h"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm continue");
  });

  test("sends message in non-interactive mode with conversation_id and message", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.SEND_MESSAGE,
      handle: mock(async () => ({ response: "Hello from Gemini!" })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["conv123", "Hello there"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Model:");
    expect(output).toContain("Hello from Gemini!");
    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: expect.objectContaining({
          conversationId: "conv123",
          message: "Hello there",
        }),
      }),
    );
  });

  test("sends correct command type via mediator", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.SEND_MESSAGE,
      handle: mock(async () => ({ response: "ok" })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["conv-id", "test message"], context);

    expect(mockHandler.handle).toHaveBeenCalledTimes(1);
  });

  test("invokes list command when no conversation_id provided", async () => {
    const mockListHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [] })),
    };
    mediator.registerQueryHandler(mockListHandler as any);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Listing conversations");
  });
});
