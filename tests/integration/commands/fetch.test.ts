import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { FetchCommand } from "../../../src/cli/commands/fetch-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { QUERY_TYPES, type FetchChatQueryResult } from "../../../src/core/query-handlers.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import { createMockMessageHistory } from "../../fixtures/chat-fixtures.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("fetch command integration", () => {
  let command: FetchCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let mediatorSendSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new FetchCommand();
    context = { verbose: false, mediator: new Mediator() };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("fetch-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

    const mockMessages = createMockMessageHistory({ count: 4 });
    mediatorSendSpy = spyOn(context.mediator, "send").mockResolvedValue({ messages: mockMessages });
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
      expect(output).toContain("--path");
      expect(output).toContain("--help");
    });

    test("-h shows usage information", async () => {
      await command.execute(["-h"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm fetch");
    });

    test("help does not send query to mediator", async () => {
      await command.execute(["--help"], context);

      expect(mediatorSendSpy).not.toHaveBeenCalled();
    });
  });

  describe("fetch with conversation id", () => {
    test("sends fetch-chat query to mediator with correct id", async () => {
      await command.execute(["conv-abc123"], context);

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.type).toBe(QUERY_TYPES.FETCH_CHAT);
      expect(sentQuery.payload.conversationId).toBe("conv-abc123");
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
      mediatorSendSpy.mockResolvedValue({ messages: mockMessages });

      await command.execute(["conv-xyz"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Hello!");
      expect(output).toContain("Hi there!");
    });

    test("shows 'No messages found' when conversation has no messages", async () => {
      mediatorSendSpy.mockResolvedValue({ messages: [] });

      await command.execute(["conv-empty"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No messages found");
    });
  });

  describe("--format json option", () => {
    test("outputs valid JSON when --format json", async () => {
      const mockMessages = createMockMessageHistory({ count: 2 });
      mediatorSendSpy.mockResolvedValue({ messages: mockMessages });

      await command.execute(["conv-abc123", "--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty("conversationId", "conv-abc123");
      expect(parsed).toHaveProperty("messages");
      expect(parsed.messages).toHaveLength(2);
    });

    test("-f json also outputs valid JSON", async () => {
      const mockMessages = createMockMessageHistory({ count: 3 });
      mediatorSendSpy.mockResolvedValue({ messages: mockMessages });

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
      mediatorSendSpy.mockResolvedValue({ messages: mockMessages });

      await command.execute(["conv-abc123", "--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.messages[0].role).toBe("user");
      expect(parsed.messages[0].content).toBe("What is TypeScript?");
      expect(parsed.messages[1].role).toBe("model");
    });
  });

  describe("--path option", () => {
    test("--path writes text output to file", async () => {
      const outputPath = join(tmpdir(), `fetch-test-${Date.now()}.txt`);

      try {
        await command.execute(["conv-abc123", "--path", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("Conversation:");
        expect(content).toContain("conv-abc123");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("-p writes text output to file", async () => {
      const outputPath = join(tmpdir(), `fetch-test-short-${Date.now()}.txt`);

      try {
        await command.execute(["conv-abc123", "-p", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("Conversation:");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("--path with json format writes JSON to file", async () => {
      const outputPath = join(tmpdir(), `fetch-test-json-${Date.now()}.json`);

      try {
        await command.execute(["conv-abc123", "--format", "json", "--path", outputPath], context);

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
    test("does not send fetch-chat query when no id is provided", async () => {
      const mockListExecute = mock(() => Promise.resolve());
      const mockListHandler = { name: "list", description: "", execute: mockListExecute };
      const mockRegistry = {
        registerAllCommands: mock(() => {}),
        getHandler: mock(() => mockListHandler),
      };
      spyOn(command as any, "invokeListCommand").mockImplementation(() => {});

      await command.execute([], context);

      expect(mediatorSendSpy).not.toHaveBeenCalled();
      expect((command as any).invokeListCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    test("propagates mediator errors", async () => {
      mediatorSendSpy.mockRejectedValue(new Error("Conversation not found"));

      await expect(command.execute(["conv-invalid"], context)).rejects.toThrow("Conversation not found");
    });

    test("propagates network errors", async () => {
      mediatorSendSpy.mockRejectedValue(new Error("Network error"));

      await expect(command.execute(["conv-abc123"], context)).rejects.toThrow("Network error");
    });
  });
});
