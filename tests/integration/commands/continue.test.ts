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
  let activeProfilesSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    command = new ContinueCommand();
    client = makeClient();
    context = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["work", "personal"]),
        findProfileForConversation: mock(() => "work"),
        ensureSession: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
        rotationInFlight: mock(() => false),
        waitForRotation: mock(async () => null),
      } as unknown as CliCommandContext["cookieSession"],
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
      context.cookieSession.findProfileForConversation = findProfileSpy;

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
      activeProfilesSpy = mock(() => ["default"]);
      context.cookieSession.activeProfiles = activeProfilesSpy;

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

  describe("rotation-await stage", () => {
    test("in-flight rotation is awaited and the send retries once", async () => {
      let sendCalls = 0;
      client.sendMessage = mock(async () => {
        sendCalls += 1;
        if (sendCalls === 1) throw new Error("Session expired or invalid.");
        return "Recovered response!";
      });
      (context.cookieSession as any).rotationInFlight = mock(() => true);
      (context.cookieSession as any).waitForRotation = mock(async () => ({ cookies: [] }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["conv-123", "hello"], context);

        expect((context.cookieSession as any).waitForRotation).toHaveBeenCalledTimes(1);
        expect((context.cookieSession as any).waitForRotation).toHaveBeenCalledWith("work");
        expect(client.sendMessage).toHaveBeenCalledTimes(2);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Recovered response!");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("rotation wait timeout rethrows the original send error", async () => {
      client.sendMessage = mock(async () => {
        throw new Error("Session expired or invalid.");
      });
      (context.cookieSession as any).rotationInFlight = mock(() => true);
      (context.cookieSession as any).waitForRotation = mock(async () => null);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await expect(command.execute(["conv-123", "hello"], context)).rejects.toThrow(
          "Session expired or invalid.",
        );
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("still in progress");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("happy path never consults the rotation state", async () => {
      await command.execute(["conv-123", "hello"], context);

      expect((context.cookieSession as any).rotationInFlight).not.toHaveBeenCalled();
      expect((context.cookieSession as any).waitForRotation).not.toHaveBeenCalled();
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
