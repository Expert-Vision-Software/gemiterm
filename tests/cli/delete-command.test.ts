import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { DeleteCommand } from "../../src/cli/commands/delete-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { COMMAND_TYPES } from "../../src/core/command-handlers.ts";

describe("DeleteCommand", () => {
  let command: DeleteCommand;
  let mediator: Mediator;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new DeleteCommand();
    mediator = new Mediator();
    context = { verbose: false, mediator };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("delete");
    expect(command.description).toBe("Delete a conversation");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm delete");
    expect(output).toContain("--force");
    expect(output).toContain("--help");
  });

  test("shows error when no conversation ID provided", async () => {
    await expect(command.execute([], context)).rejects.toThrow("process.exit called");

    const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("conversation ID is required");
  });

  test("sends delete-conversation command with --force flag", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.DELETE_CONVERSATION,
      handle: mock(async () => ({ success: true })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["abc123", "--force"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ conversationId: "abc123" }),
      }),
    );

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("abc123");
    expect(output).toContain("deleted");
  });

  test("sends delete-conversation command with -f short flag", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.DELETE_CONVERSATION,
      handle: mock(async () => ({ success: true })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await command.execute(["abc123", "-f"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ conversationId: "abc123" }),
      }),
    );
  });

  test("handles failed deletion", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.DELETE_CONVERSATION,
      handle: mock(async () => ({ success: false })),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await expect(command.execute(["abc123", "--force"], context)).rejects.toThrow(
      "process.exit called",
    );

    const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Failed to delete conversation");
  });

  test("handles error from handler", async () => {
    const mockHandler = {
      commandType: COMMAND_TYPES.DELETE_CONVERSATION,
      handle: mock(async () => {
        throw new Error("Network error");
      }),
    };
    mediator.registerCommandHandler(mockHandler as any);

    await expect(command.execute(["abc123", "--force"], context)).rejects.toThrow(
      "process.exit called",
    );

    const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Network error");
  });
});
