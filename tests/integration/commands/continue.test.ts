import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ContinueCommand } from "../../../src/cli/commands/continue-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";

function makeClient() {
  const client: any = {
    sendMessage: mock(async (_id: string, _msg: string): Promise<string> => "Hello!"),
    fetchChat: mock(async (_id: string): Promise<any[]> => []),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("continue command integration", () => {
  let command: ContinueCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let findProfileSpy: ReturnType<typeof mock>;
  let getActiveProfilesSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    command = new ContinueCommand();
    client = makeClient();
    context = {
      verbose: false,
      profileAuthManager: {
        getActiveProfiles: mock(() => ["work", "personal"]),
        findProfileForConversation: mock(() => "work"),
        ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["profileAuthManager"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("continue-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    teardownTestConfig(originalEnv);
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("continue");
      expect(command.description).toBe("Continue a conversation");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm continue");
    });

    test("help does not send message to client", async () => {
      await command.execute(["--help"], context);

      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("profile lookup", () => {
    test("resolves the profile that owns the conversation", async () => {
      await command.execute(["conv-123", "hello"], context);

      expect(client.sendMessage).toHaveBeenCalledTimes(1);
      expect(client.forProfile).toHaveBeenCalledWith("work");
      expect(client.sendMessage).toHaveBeenCalledWith("conv-123", "hello");
    });

    test("throws AuthenticationError when no profile owns the conversation", async () => {
      findProfileSpy = mock(() => null);
      context.profileAuthManager.findProfileForConversation = findProfileSpy;

      await expect(command.execute(["unknown-id", "hello"], context)).rejects.toThrow(AuthenticationError);

      const errorMessage = (await (async () => {
        try {
          await command.execute(["unknown-id", "hello"], context);
        } catch (e) {
          return (e as Error).message;
        }
      })()) as string;
      expect(errorMessage).toContain("Could not find a profile that owns conversation 'unknown-id'");
      expect(errorMessage).toContain("gemiterm list --all-profiles");
    });

    test("uses default profile when only one profile is active", async () => {
      getActiveProfilesSpy = mock(() => ["default"]);
      context.profileAuthManager.getActiveProfiles = getActiveProfilesSpy;

      await command.execute(["conv-123", "hello"], context);

      expect(client.sendMessage).toHaveBeenCalledTimes(1);
      expect(client.sendMessage).toHaveBeenCalledWith("conv-123", "hello");
      expect(client.forProfile).not.toHaveBeenCalled();
    });
  });

  describe("non-interactive mode", () => {
    test("sends message to client", async () => {
      await command.execute(["conv-123", "hello world"], context);

      expect(client.sendMessage).toHaveBeenCalledTimes(1);
      expect(client.sendMessage).toHaveBeenCalledWith("conv-123", "hello world");
    });

    test("prints model response", async () => {
      await command.execute(["conv-123", "hello"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Model:");
      expect(output).toContain("Hello!");
    });
  });
});
