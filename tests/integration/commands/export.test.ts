import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ExportCommand } from "../../../src/cli/commands/export-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { QUERY_TYPES } from "../../../src/core/query-handlers.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import { createMockMessageHistory } from "../../fixtures/chat-fixtures.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("export command integration", () => {
  let command: ExportCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let mediatorSendSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ExportCommand();
    context = { verbose: false, mediator: new Mediator() };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any;
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("export-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

    const mockMessages = createMockMessageHistory({ count: 4 });
    mediatorSendSpy = spyOn(context.mediator, "send").mockResolvedValue({ messages: mockMessages });
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
      expect(command.name).toBe("export");
      expect(command.description).toBe("Export a conversation to a file");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm export");
      expect(output).toContain("--output");
      expect(output).toContain("--format");
      expect(output).toContain("--include-metadata");
      expect(output).toContain("--help");
    });

    test("-h shows usage information", async () => {
      await command.execute(["-h"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm export");
    });

    test("help does not send query to mediator", async () => {
      await command.execute(["--help"], context);

      expect(mediatorSendSpy).not.toHaveBeenCalled();
    });
  });

  describe("export with conversation id", () => {
    test("sends fetch-chat query to mediator with correct id", async () => {
      const outputPath = join(tmpdir(), `export-test-${Date.now()}.md`);

      try {
        await command.execute(["conv-abc123", "--output", outputPath], context);

        expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
        const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
        expect(sentQuery.type).toBe(QUERY_TYPES.FETCH_CHAT);
        expect(sentQuery.payload.conversationId).toBe("conv-abc123");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("creates markdown file with exported content", async () => {
      const outputPath = join(tmpdir(), `export-md-${Date.now()}.md`);

      try {
        await command.execute(["conv-abc123", "--output", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("# conv-abc123");
        expect(content).toContain("Hello, Gemini!");
        expect(content).toContain("Hi there! How can I help you today?");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("includes exported conversation id in success message", async () => {
      const outputPath = join(tmpdir(), `export-msg-${Date.now()}.md`);

      try {
        await command.execute(["conv-xyz", "--output", outputPath], context);

        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Exported conversation");
        expect(output).toContain("conv-xyz");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });
  });

  describe("--format json option", () => {
    test("creates JSON file when --format json", async () => {
      const outputPath = join(tmpdir(), `export-json-${Date.now()}.json`);

      try {
        await command.execute(["conv-abc123", "--format", "json", "--output", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed).toHaveProperty("conversationId", "conv-abc123");
        expect(parsed).toHaveProperty("messages");
        expect(parsed.messages).toHaveLength(4);
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("-f json also creates JSON file", async () => {
      const outputPath = join(tmpdir(), `export-f-json-${Date.now()}.json`);

      try {
        await command.execute(["conv-abc123", "-f", "json", "--output", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.messages).toHaveLength(4);
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("JSON output contains message roles and content", async () => {
      const mockMessages = createMockMessageHistory({
        count: 2,
        roles: ["user", "model"],
        contents: ["What is Bun?", "Bun is a fast JavaScript runtime."],
      });
      mediatorSendSpy.mockResolvedValue({ messages: mockMessages });

      const outputPath = join(tmpdir(), `export-json-roles-${Date.now()}.json`);

      try {
        await command.execute(["conv-abc123", "--format", "json", "--output", outputPath], context);

        const content = readFileSync(outputPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.messages[0].role).toBe("user");
        expect(parsed.messages[0].content).toBe("What is Bun?");
        expect(parsed.messages[1].role).toBe("model");
        expect(parsed.messages[1].content).toBe("Bun is a fast JavaScript runtime.");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });
  });

  describe("--output option", () => {
    test("--output writes to specified path", async () => {
      const outputPath = join(tmpdir(), `export-custom-${Date.now()}.md`);

      try {
        await command.execute(["conv-abc123", "--output", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("# conv-abc123");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("-o also writes to specified path", async () => {
      const outputPath = join(tmpdir(), `export-short-${Date.now()}.md`);

      try {
        await command.execute(["conv-abc123", "-o", outputPath], context);

        expect(existsSync(outputPath)).toBe(true);
        const content = readFileSync(outputPath, "utf-8");
        expect(content).toContain("# conv-abc123");
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    });

    test("--output with --format json writes JSON to specified path", async () => {
      const outputPath = join(tmpdir(), `export-o-json-${Date.now()}.json`);

      try {
        await command.execute(["conv-abc123", "--output", outputPath, "--format", "json"], context);

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
    test("exits with error when no conversation id is provided", async () => {
      try {
        await command.execute([], context);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect((error as Error).message).toBe("process.exit(1)");
        expect(exitSpy).toHaveBeenCalledWith(1);
      }

      const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(errorOutput).toContain("conversation ID is required");
      expect(mediatorSendSpy).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    test("exits with error when mediator throws", async () => {
      mediatorSendSpy.mockRejectedValue(new Error("Network error"));

      try {
        const outputPath = join(tmpdir(), `export-err-${Date.now()}.md`);
        await command.execute(["conv-abc123", "--output", outputPath], context);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect((error as Error).message).toBe("process.exit(1)");
        expect(exitSpy).toHaveBeenCalledWith(1);
      }

      const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(errorOutput).toContain("Network error");
    });
  });
});
