import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ContinueCommand } from "../../../src/cli/commands/continue-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { COMMAND_TYPES, type SendMessageCommandPayload, type SendMessageCommandResult } from "../../../src/core/command-handlers.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";

describe("continue command integration", () => {
  let command: ContinueCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let mediatorSendSpy: ReturnType<typeof spyOn>;
  let findProfileSpy: ReturnType<typeof mock>;
  let getActiveProfilesSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    command = new ContinueCommand();
    context = {
      verbose: false,
      mediator: new Mediator(),
      profileAuthManager: {
        getActiveProfiles: mock(() => ["work", "personal"]),
        findProfileForConversation: mock(() => "work"),
        ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["profileAuthManager"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("continue-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

    mediatorSendSpy = spyOn(context.mediator, "send").mockResolvedValue({ response: "Hello!" } as SendMessageCommandResult);
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

    test("help does not send command to mediator", async () => {
      await command.execute(["--help"], context);

      expect(mediatorSendSpy).not.toHaveBeenCalled();
    });
  });

  describe("profile lookup", () => {
    test("resolves the profile that owns the conversation", async () => {
      await command.execute(["conv-123", "hello"], context);

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
      const sentCommand = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentCommand.type).toBe(COMMAND_TYPES.SEND_MESSAGE);
      expect(sentCommand.payload.profileName).toBe("work");
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

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
      const sentCommand = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentCommand.payload.profileName).toBeUndefined();
    });
  });

  describe("non-interactive mode", () => {
    test("sends message to mediator", async () => {
      await command.execute(["conv-123", "hello world"], context);

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
      const sentCommand = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentCommand.type).toBe(COMMAND_TYPES.SEND_MESSAGE);
      expect(sentCommand.payload.conversationId).toBe("conv-123");
      expect(sentCommand.payload.message).toBe("hello world");
    });

    test("prints model response", async () => {
      await command.execute(["conv-123", "hello"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Model:");
      expect(output).toContain("Hello!");
    });
  });
});
