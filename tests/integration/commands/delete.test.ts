import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { DeleteCommand } from "../../../src/cli/commands/delete-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";

function makeClient() {
  const client: any = {
    deleteChat: mock(async (_id: string): Promise<void> => {}),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("delete command integration", () => {
  let command: DeleteCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let findProfileSpy: ReturnType<typeof mock>;
  let activeProfilesSpy: ReturnType<typeof mock>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new DeleteCommand();
    client = makeClient();
    context = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["work", "personal"]),
        findProfileForConversation: mock(() => "work"),
        ensureSession: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("delete-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    teardownTestConfig(originalEnv);
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("delete");
      expect(command.description).toBe("Delete a conversation");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm delete");
    });

    test("help does not call the client", async () => {
      await command.execute(["--help"], context);

      expect(client.deleteChat).not.toHaveBeenCalled();
    });
  });

  describe("profile lookup", () => {
    test("resolves the profile that owns the conversation", async () => {
      await command.execute(["conv-123", "--force"], context);

      expect(client.deleteChat).toHaveBeenCalledTimes(1);
      expect(client.forProfile).toHaveBeenCalledWith("work");
      expect(client.deleteChat).toHaveBeenCalledWith("conv-123");
    });

    test("throws AuthenticationError when no profile owns the conversation", async () => {
      findProfileSpy = mock(() => null);
      context.cookieSession.findProfileForConversation = findProfileSpy;

      await expect(command.execute(["unknown-id", "--force"], context)).rejects.toThrow(AuthenticationError);

      const errorMessage = (await (async () => {
        try {
          await command.execute(["unknown-id", "--force"], context);
        } catch (e) {
          return (e as Error).message;
        }
      })()) as string;
      expect(errorMessage).toContain("Could not find a profile that owns conversation 'unknown-id'");
      expect(errorMessage).toContain("gemiterm list --all-profiles");
    });

    test("uses default profile when only one profile is active", async () => {
      activeProfilesSpy = mock(() => ["default"]);
      context.cookieSession.activeProfiles = activeProfilesSpy;

      await command.execute(["conv-123", "--force"], context);

      expect(client.deleteChat).toHaveBeenCalledTimes(1);
      expect(client.deleteChat).toHaveBeenCalledWith("conv-123");
      expect(client.forProfile).not.toHaveBeenCalled();
    });
  });

  describe("delete execution", () => {
    test("deletes the conversation with the correct id", async () => {
      await command.execute(["conv-123", "--force"], context);

      expect(client.deleteChat).toHaveBeenCalledTimes(1);
      expect(client.deleteChat).toHaveBeenCalledWith("conv-123");
    });

    test("prints success message", async () => {
      await command.execute(["conv-123", "--force"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("deleted");
      expect(output).toContain("conv-123");
    });

    test("exits with error when the client fails", async () => {
      client.deleteChat.mockRejectedValue(new Error("Network error"));

      await expect(command.execute(["conv-123", "--force"], context)).rejects.toThrow("process.exit called");
    });
  });
});
