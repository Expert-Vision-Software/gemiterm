import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { FetchCommand } from "../../../src/cli/commands/fetch-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import type { Message } from "../../../src/core/types.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import { createMockMessageHistory } from "../../fixtures/chat-fixtures.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeClient() {
  const client: any = {
    fetchChat: mock(async (_id: string): Promise<Message[]> => []),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("fetch command integration", () => {
  let command: FetchCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    command = new FetchCommand();
    client = makeClient();
    const cookieSession = {
      activeProfiles: mock(() => ["default"]),
      findProfileForConversation: mock(() => Promise.resolve(null)),
      ensureSession: mock(() => {
        throw new Error("not used");
      }),
      rotationInFlight: mock(() => false),
      waitForRotation: mock(async () => null),
    };
    context = {
      verbose: false,
      cookieSession: cookieSession as any,
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("fetch-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

    const mockMessages = createMockMessageHistory({ count: 4 });
    client.fetchChat = mock(async () => mockMessages);
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    teardownTestConfig(originalEnv);
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("fetch");
      expect(command.description).toBe("Fetch and display a conversation");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm fetch");
      expect(output).toContain("--format");
      expect(output).toContain("--out");
      expect(output).toContain("--help");
    });

    test("-h shows usage information", async () => {
      await command.execute(["-h"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm fetch");
    });

    test("help does not call the client", async () => {
      await command.execute(["--help"], context);

      expect(client.fetchChat).not.toHaveBeenCalled();
    });
  });

  describe("fetch with conversation id", () => {
    test("fetches the conversation with the correct id", async () => {
      await command.execute(["conv-abc123"], context);

      expect(client.fetchChat).toHaveBeenCalledTimes(1);
      expect(client.fetchChat).toHaveBeenCalledWith("conv-abc123");
    });

    test("returns formatted text output by default", async () => {
      await command.execute(["conv-abc123"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Conversation:");
      expect(output).toContain("conv-abc123");
      expect(output).toContain("User:");
      expect(output).toContain("Model:");
    });

    test("displays message content in text output", async () => {
      const mockMessages = createMockMessageHistory({
        count: 2,
        contents: ["Hello!", "Hi there!"],
      });
      client.fetchChat = mock(async () => mockMessages);

      await command.execute(["conv-xyz"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Hello!");
      expect(output).toContain("Hi there!");
    });

    test("shows 'No messages found' when conversation has no messages", async () => {
      client.fetchChat = mock(async () => []);

      await command.execute(["conv-empty"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No messages found");
    });
  });

  describe("--format json option", () => {
    test("outputs valid JSON when --format json", async () => {
      const mockMessages = createMockMessageHistory({ count: 2 });
      client.fetchChat = mock(async () => mockMessages);

      await command.execute(["conv-abc123", "--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty("conversationId", "conv-abc123");
      expect(parsed).toHaveProperty("messages");
      expect(parsed.messages).toHaveLength(2);
    });

    test("-f json also outputs valid JSON", async () => {
      const mockMessages = createMockMessageHistory({ count: 3 });
      client.fetchChat = mock(async () => mockMessages);

      await command.execute(["conv-abc123", "-f", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.messages).toHaveLength(3);
    });

    test("JSON output contains message roles and content", async () => {
      const mockMessages = createMockMessageHistory({
        count: 2,
        roles: ["user", "model"],
        contents: ["What is TypeScript?", "TypeScript is a typed superset of JavaScript."],
      });
      client.fetchChat = mock(async () => mockMessages);

      await command.execute(["conv-abc123", "--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.messages[0].role).toBe("user");
      expect(parsed.messages[0].content).toBe("What is TypeScript?");
      expect(parsed.messages[1].role).toBe("model");
    });
  });

  describe("--out option", () => {
    test("--out writes text output to file", async () => {
      const outputPath = join(tmpdir(), `fetch-test-${Date.now()}.txt`);

      try {
        await command.execute(["conv-abc123", "--out", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("Conversation:");
        expect(content).toContain("conv-abc123");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("-o writes text output to file", async () => {
      const outputPath = join(tmpdir(), `fetch-test-short-${Date.now()}.txt`);

      try {
        await command.execute(["conv-abc123", "-o", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("Conversation:");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("--out with json format writes JSON to file", async () => {
      const outputPath = join(tmpdir(), `fetch-test-json-${Date.now()}.json`);

      try {
        await command.execute(["conv-abc123", "--format", "json", "--out", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed).toHaveProperty("conversationId");
        expect(parsed).toHaveProperty("messages");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });
  });

  describe("no conversation id", () => {
    test("does not fetch when no id is provided", async () => {
      const listExecute = mock(() => Promise.resolve());
      mock.module("../../../src/cli/command-registry.ts", () => ({
        CommandRegistry: class {
          registerAllCommands(): void {}
          getHandler(name: string): { execute: ReturnType<typeof mock> } | undefined {
            if (name === "list") return { execute: listExecute };
            return undefined;
          }
        },
      }));

      await command.execute([], context);

      expect(client.fetchChat).not.toHaveBeenCalled();
      expect(listExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    test("propagates client errors", async () => {
      client.fetchChat.mockRejectedValue(new Error("Conversation not found"));

      await expect(command.execute(["conv-invalid"], context)).rejects.toThrow("Conversation not found");
    });

    test("propagates network errors", async () => {
      client.fetchChat.mockRejectedValue(new Error("Network error"));

      await expect(command.execute(["conv-abc123"], context)).rejects.toThrow("Network error");
    });
  });

  describe("multi-profile routing", () => {
    test("auto-discovers owning profile and forwards it to forProfile", async () => {
      (context.cookieSession as any).activeProfiles.mockReturnValue(["dhb-work", "evs-diegohb"]);
      (context.cookieSession as any).findProfileForConversation.mockResolvedValue("evs-diegohb");

      await command.execute(["conv-evs"], context);

      expect(client.forProfile).toHaveBeenCalledWith("evs-diegohb");
      expect(client.fetchChat).toHaveBeenCalledWith("conv-evs");
      expect((context.cookieSession as any).findProfileForConversation).toHaveBeenCalledWith("conv-evs");
    });

    test("--profile overrides auto-discovery", async () => {
      (context.cookieSession as any).activeProfiles.mockReturnValue(["dhb-work", "evs-diegohb"]);
      (context.cookieSession as any).findProfileForConversation.mockResolvedValue("dhb-work");

      await command.execute(["conv-x", "--profile", "evs-diegohb"], context);

      expect(client.forProfile).toHaveBeenCalledWith("evs-diegohb");
      expect((context.cookieSession as any).findProfileForConversation).not.toHaveBeenCalled();
    });

    test("-p short flag also overrides discovery", async () => {
      (context.cookieSession as any).activeProfiles.mockReturnValue(["dhb-work", "evs-diegohb"]);

      await command.execute(["conv-x", "-p", "evs-diegohb"], context);

      expect(client.forProfile).toHaveBeenCalledWith("evs-diegohb");
    });

    test("omits forProfile when only one profile is active", async () => {
      (context.cookieSession as any).activeProfiles.mockReturnValue(["default"]);
      (context.cookieSession as any).findProfileForConversation.mockResolvedValue(null);

      await command.execute(["conv-1"], context);

      expect(client.fetchChat).toHaveBeenCalledWith("conv-1");
      expect(client.forProfile).not.toHaveBeenCalled();
      expect((context.cookieSession as any).findProfileForConversation).not.toHaveBeenCalled();
    });

    test("throws AuthenticationError when --profile names a profile with no valid session", async () => {
      (context.cookieSession as any).activeProfiles.mockReturnValue(["dhb-work"]);

      await expect(
        command.execute(["conv-x", "--profile", "expired-profile"], context),
      ).rejects.toThrow(/has no valid session/);
    });

    test("throws AuthenticationError when no active profile owns the conversation and --profile is not given", async () => {
      (context.cookieSession as any).activeProfiles.mockReturnValue(["dhb-work", "evs-diegohb"]);
      (context.cookieSession as any).findProfileForConversation.mockResolvedValue(null);

      await expect(command.execute(["conv-orphan"], context)).rejects.toThrow(
        /Could not find a profile that owns conversation/,
      );
    });
  });

  describe("rotation-await stage", () => {
    test("in-flight rotation is awaited and the retried fetch renders", async () => {
      const messages = createMockMessageHistory({ count: 2, contents: ["Hello!", "Hi there!"] });
      let fetchCalls = 0;
      client.fetchChat = mock(async () => {
        fetchCalls += 1;
        return fetchCalls === 1 ? [] : messages;
      });
      (context.cookieSession as any).rotationInFlight = mock(() => true);
      (context.cookieSession as any).waitForRotation = mock(async () => ({ cookies: [] }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["conv-abc123"], context);

        expect((context.cookieSession as any).waitForRotation).toHaveBeenCalledTimes(1);
        expect((context.cookieSession as any).waitForRotation).toHaveBeenCalledWith("default");
        expect(client.fetchChat).toHaveBeenCalledTimes(2);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Hello!");
        expect(output).not.toContain("No messages found");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("rotation wait timeout rethrows the original error and prints the hint", async () => {
      client.fetchChat.mockRejectedValue(new Error("Session expired or invalid."));
      (context.cookieSession as any).rotationInFlight = mock(() => true);
      (context.cookieSession as any).waitForRotation = mock(async () => null);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await expect(command.execute(["conv-abc123"], context)).rejects.toThrow(
          "Session expired or invalid.",
        );
        expect(client.fetchChat).toHaveBeenCalledTimes(1);
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("still in progress");
        expect(stderr).toContain("re-run");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("happy path never consults the rotation state", async () => {
      await command.execute(["conv-abc123"], context);

      expect((context.cookieSession as any).rotationInFlight).not.toHaveBeenCalled();
      expect((context.cookieSession as any).waitForRotation).not.toHaveBeenCalled();
      expect(client.fetchChat).toHaveBeenCalledTimes(1);
    });
  });
});
