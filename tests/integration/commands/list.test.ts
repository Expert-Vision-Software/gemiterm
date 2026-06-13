import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ListCommand } from "../../../src/cli/commands/list-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { QUERY_TYPES, type ListChatsQueryPayload, type ListChatsQueryResult } from "../../../src/core/query-handlers.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import { createMockChatList } from "../../fixtures/chat-fixtures.ts";
import * as configModule from "../../../src/infrastructure/config.ts";

describe("list command integration", () => {
  let command: ListCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let mediatorSendSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ListCommand();
    context = { verbose: false, mediator: new Mediator() };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("list-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

    const mockChats = createMockChatList({ count: 5 });
    mediatorSendSpy = spyOn(context.mediator, "send").mockResolvedValue({ chats: mockChats });
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    teardownTestConfig(originalEnv);
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("list");
      expect(command.description).toBe("List conversations");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm list");
      expect(output).toContain("--limit");
      expect(output).toContain("--search");
      expect(output).toContain("--format");
    });

    test("-h shows usage information", async () => {
      await command.execute(["-h"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm list");
    });

    test("help does not send query to mediator", async () => {
      await command.execute(["--help"], context);

      expect(mediatorSendSpy).not.toHaveBeenCalled();
    });
  });

  describe("list with mock data", () => {
    test("sends list-chats query to mediator", async () => {
      await command.execute([], context);

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.type).toBe(QUERY_TYPES.LIST_CHATS);
    });

    test("returns formatted table output by default", async () => {
      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("ID");
      expect(output).toContain("TITLE");
      expect(output).toContain("DATE");
      expect(output).toContain("Total:");
    });

    test("displays chat IDs in output", async () => {
      const mockChats = createMockChatList({ count: 3 });
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      for (const chat of mockChats) {
        expect(output).toContain(chat.id);
      }
    });

    test("displays empty message when no chats", async () => {
      mediatorSendSpy.mockResolvedValue({ chats: [] });

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No conversations found");
    });
  });

  describe("--limit option", () => {
    test("--limit 2 passes limit to mediator query", async () => {
      await command.execute(["--limit", "2"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.limit).toBe(2);
    });

    test("-n 5 passes limit to mediator query", async () => {
      await command.execute(["-n", "5"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.limit).toBe(5);
    });

    test("limits output to specified number of results", async () => {
      const mockChats = createMockChatList({ count: 10 });
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["--limit", "3"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const lines = output.split("\n");
      const dataLines = lines.filter((l) => l.includes("\u2502") && !l.includes("Total:"));
      expect(dataLines.length).toBeLessThanOrEqual(4);
    });
  });

  describe("--format json option", () => {
    test("outputs valid JSON when --format json", async () => {
      const mockChats = createMockChatList({ count: 3 });
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty("chats");
      expect(parsed.chats).toHaveLength(3);
    });

    test("-f json also outputs valid JSON", async () => {
      const mockChats = createMockChatList({ count: 2 });
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["-f", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.chats).toHaveLength(2);
    });

    test("JSON output contains chat ids and titles", async () => {
      const mockChats = createMockChatList({ count: 2, ids: ["id-one", "id-two"], titles: ["First", "Second"] });
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.chats[0].id).toBe("id-one");
      expect(parsed.chats[0].title).toBe("First");
    });
  });

  describe("--search option", () => {
    test("--search passes search term to mediator query", async () => {
      await command.execute(["--search", "TypeScript"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.search).toBe("TypeScript");
    });

    test("-s passes search term to mediator query", async () => {
      await command.execute(["-s", "Bun"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.search).toBe("Bun");
    });
  });

  describe("default limit behaviour", () => {
    test("omitting --limit sends query without limit", async () => {
      await command.execute([], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.limit).toBeUndefined();
    });

    test("--limit N sends N as limit", async () => {
      await command.execute(["--limit", "7"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.limit).toBe(7);
    });
  });

  describe("sort options", () => {
    test("default sort is recent", async () => {
      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Total:");
    });

    test("--sort oldest is accepted", async () => {
      await command.execute(["--sort", "oldest"], context);

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    });

    test("--sort alpha is accepted", async () => {
      await command.execute(["--sort", "alpha"], context);

      expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("--all-profiles flag", () => {
    test("renders Profile column when --all-profiles is set", async () => {
      const mockChats = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
        { id: "conv-2", title: "Chat 2", isPinned: false, timestamp: Date.now(), profile: "personal" },
      ];
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["--all-profiles"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("PROFILE");
      expect(output).toContain("work");
      expect(output).toContain("personal");
    });

    test("omits Profile column when --all-profiles is not set", async () => {
      const mockChats = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
      ];
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).not.toContain("PROFILE");
    });

    test("JSON output includes profile field only when --all-profiles is set", async () => {
      const mockChatsWithProfile = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
      ];
      mediatorSendSpy.mockResolvedValue({ chats: mockChatsWithProfile });

      await command.execute(["--all-profiles", "--format", "json"], context);
      const outputWithFlag = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsedWithFlag = JSON.parse(outputWithFlag);
      expect(parsedWithFlag.chats[0]).toHaveProperty("profile");
      expect(parsedWithFlag.chats[0].profile).toBe("work");

      const mockChatsWithoutProfile = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now() },
      ];
      logSpy.mockClear();
      mediatorSendSpy.mockResolvedValue({ chats: mockChatsWithoutProfile });
      await command.execute(["--format", "json"], context);
      const outputWithoutFlag = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsedWithoutFlag = JSON.parse(outputWithoutFlag);
      expect(parsedWithoutFlag.chats[0]).not.toHaveProperty("profile");
    });
  });

  describe("--profile / -p flag", () => {
    test("--help documents --profile flag", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("--profile");
      expect(output).toContain("-p");
    });

    test("--profile work sends profile in query payload", async () => {
      await command.execute(["--profile", "work"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.profile).toBe("work");
    });

    test("-p short flag sends profile in query payload", async () => {
      await command.execute(["-p", "personal"], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.profile).toBe("personal");
    });

    test("without --profile, payload.profile is undefined", async () => {
      await command.execute([], context);

      const sentQuery = mediatorSendSpy.mock.calls[0][0] as any;
      expect(sentQuery.payload.profile).toBeUndefined();
    });

    test("--profile renders Profile column in text output", async () => {
      const mockChats = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
      ];
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["--profile", "work"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("PROFILE");
      expect(output).toContain("work");
    });

    test("--profile filters to one profile in JSON output", async () => {
      const mockChats = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
      ];
      mediatorSendSpy.mockResolvedValue({ chats: mockChats });

      await command.execute(["--profile", "work", "--format", "json"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.chats).toHaveLength(1);
      expect(parsed.chats[0].profile).toBe("work");
    });
  });

  describe("error handling", () => {
    test("propagates mediator errors", async () => {
      mediatorSendSpy.mockRejectedValue(new Error("Network error"));

      await expect(command.execute([], context)).rejects.toThrow("Network error");
    });
  });
});
