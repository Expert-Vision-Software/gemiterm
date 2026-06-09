import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { NewCommand } from "../../src/cli/commands/new-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { COMMAND_TYPES } from "../../src/core/command-handlers.ts";

describe("NewCommand", () => {
  let command: NewCommand;
  let mediator: Mediator;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new NewCommand();
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
    expect(command.name).toBe("new");
    expect(command.description).toBe("Start a new conversation");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm new");
    expect(output).toContain("--profile");
    expect(output).toContain("message");
  });

  test("shows help with -h flag", async () => {
    await command.execute(["-h"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm new");
  });

  test("sends start-new-chat command with message", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.START_NEW_CHAT,
      handle: mock(async () => ({
        response: "Hello from Gemini!",
        conversationId: "conv-123",
      })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["Hello there"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMMAND_TYPES.START_NEW_CHAT,
        payload: expect.objectContaining({
          message: "Hello there",
        }),
      }),
    );

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("conv-123");
    expect(output).toContain("Hello from Gemini!");
  });

  test("sends start-new-chat command with profile specified via -p", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.START_NEW_CHAT,
      handle: mock(async () => ({
        response: "Hello from Gemini!",
        conversationId: "conv-456",
      })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["-p", "dhb-worker", "a new test message"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMMAND_TYPES.START_NEW_CHAT,
        payload: expect.objectContaining({
          message: "a new test message",
          profileName: "dhb-worker",
        }),
      }),
    );
  });

  test("sends start-new-chat command with profile specified via --profile", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.START_NEW_CHAT,
      handle: mock(async () => ({
        response: "Hello from Gemini!",
        conversationId: "conv-789",
      })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["--profile", "my-profile", "test message"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMMAND_TYPES.START_NEW_CHAT,
        payload: expect.objectContaining({
          message: "test message",
          profileName: "my-profile",
        }),
      }),
    );
  });

  test("does not include profileName in payload when no profile specified", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.START_NEW_CHAT,
      handle: mock(async () => ({
        response: "Hello",
        conversationId: "conv-abc",
      })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["hello"], context);

    const call = mockHandler.handle.mock.calls[0][0];
    expect(call.payload.profileName).toBeUndefined();
  });
});
