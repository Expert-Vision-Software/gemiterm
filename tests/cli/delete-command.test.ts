import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { DeleteCommand } from "../../src/cli/commands/delete-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";

function makeClient() {
  const client: any = {
    deleteChat: mock(async (_id: string): Promise<void> => {}),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("DeleteCommand", () => {
  let command: DeleteCommand;
  let client: ReturnType<typeof makeClient>;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new DeleteCommand();
    client = makeClient();
    context = {
      verbose: false,
      profileAuthManager: {
        getActiveProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["profileAuthManager"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
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
    await command.execute(["abc123", "--force"], context);

    expect(client.deleteChat).toHaveBeenCalledWith("abc123");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("abc123");
    expect(output).toContain("deleted");
  });

  test("sends delete-conversation command with -f short flag", async () => {
    await command.execute(["abc123", "-f"], context);

    expect(client.deleteChat).toHaveBeenCalledWith("abc123");
  });

  test("handles failed deletion", async () => {
    client.deleteChat = mock(async () => {
      throw new Error("Failed to delete conversation");
    });

    await expect(command.execute(["abc123", "--force"], context)).rejects.toThrow(
      "process.exit called",
    );

    const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Failed to delete conversation");
  });

  test("handles error from handler", async () => {
    client.deleteChat = mock(async () => {
      throw new Error("Network error");
    });

    await expect(command.execute(["abc123", "--force"], context)).rejects.toThrow(
      "process.exit called",
    );

    const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errorOutput).toContain("Network error");
  });

  test("--profile forwards the profile name into DELETE_CONVERSATION payload", async () => {
    (context.profileAuthManager as any).getActiveProfiles.mockReturnValue(["evs-diegohb"]);

    await command.execute(["abc123", "--force", "--profile", "evs-diegohb"], context);

    expect(client.forProfile).toHaveBeenCalledWith("evs-diegohb");
    expect(client.deleteChat).toHaveBeenCalledWith("abc123");
  });

  test("auto-discovers owning profile and forwards it into DELETE_CONVERSATION payload", async () => {
    (context.profileAuthManager as any).getActiveProfiles.mockReturnValue(["dhb-work", "evs-diegohb"]);
    (context.profileAuthManager as any).findProfileForConversation.mockResolvedValue("evs-diegohb");

    await command.execute(["abc123", "--force"], context);

    expect((context.profileAuthManager as any).findProfileForConversation).toHaveBeenCalledWith("abc123");
    expect(client.forProfile).toHaveBeenCalledWith("evs-diegohb");
    expect(client.deleteChat).toHaveBeenCalledWith("abc123");
  });
});
