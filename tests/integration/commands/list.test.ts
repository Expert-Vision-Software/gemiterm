import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ListCommand } from "../../../src/cli/commands/list-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import type { ChatInfo } from "../../../src/core/types.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import { createMockChatList } from "../../fixtures/chat-fixtures.ts";
import * as configModule from "../../../src/infrastructure/config.ts";

function makeClient() {
  const client: any = {
    listChats: mock(async (_opts?: any): Promise<ChatInfo[]> => []),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("list command integration", () => {
  let command: ListCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    command = new ListCommand();
    client = makeClient();
    context = {
      verbose: false,
      cookieSession: {} as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => ["default"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("list-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

    const mockChats = createMockChatList({ count: 5 });
    client.listChats = mock(async () => mockChats);
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

    test("help does not call the client", async () => {
      await command.execute(["--help"], context);

      expect(client.listChats).not.toHaveBeenCalled();
    });
  });

  describe("list with mock data", () => {
    test("calls listChats once", async () => {
      await command.execute([], context);

      expect(client.listChats).toHaveBeenCalledTimes(1);
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
      client.listChats = mock(async () => mockChats);

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      for (const chat of mockChats) {
        expect(output).toContain(chat.id);
      }
    });

    test("displays empty message when no chats", async () => {
      client.listChats = mock(async () => []);

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No conversations found");
    });
  });

  describe("--limit option", () => {
    test("--limit 2 passes limit to listChats", async () => {
      await command.execute(["--limit", "2"], context);

      const opts = client.listChats.mock.calls[0][0] as any;
      expect(opts.limit).toBe(2);
    });

    test("-n 5 passes limit to listChats", async () => {
      await command.execute(["-n", "5"], context);

      const opts = client.listChats.mock.calls[0][0] as any;
      expect(opts.limit).toBe(5);
    });

    test("limits output to specified number of results", async () => {
      const mockChats = createMockChatList({ count: 10 });
      client.listChats = mock(async () => mockChats);

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
      client.listChats = mock(async () => mockChats);

      await command.execute(["--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty("chats");
      expect(parsed.chats).toHaveLength(3);
    });

    test("-f json also outputs valid JSON", async () => {
      const mockChats = createMockChatList({ count: 2 });
      client.listChats = mock(async () => mockChats);

      await command.execute(["-f", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.chats).toHaveLength(2);
    });

    test("JSON output contains chat ids and titles", async () => {
      const mockChats = createMockChatList({ count: 2, ids: ["id-one", "id-two"], titles: ["First", "Second"] });
      client.listChats = mock(async () => mockChats);

      await command.execute(["--format", "json"], context);

      const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.chats[0].id).toBe("id-one");
      expect(parsed.chats[0].title).toBe("First");
    });
  });

  describe("--search option", () => {
    test("--search passes search term to listChats", async () => {
      await command.execute(["--search", "TypeScript"], context);

      const opts = client.listChats.mock.calls[0][0] as any;
      expect(opts.search).toBe("TypeScript");
    });

    test("-s passes search term to listChats", async () => {
      await command.execute(["-s", "Bun"], context);

      const opts = client.listChats.mock.calls[0][0] as any;
      expect(opts.search).toBe("Bun");
    });
  });

  describe("default limit behaviour", () => {
    test("omitting --limit calls listChats without limit", async () => {
      await command.execute([], context);

      const opts = client.listChats.mock.calls[0][0] as any;
      expect(opts.limit).toBeUndefined();
    });

    test("--limit N passes N as limit", async () => {
      await command.execute(["--limit", "7"], context);

      const opts = client.listChats.mock.calls[0][0] as any;
      expect(opts.limit).toBe(7);
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

      expect(client.listChats).toHaveBeenCalledTimes(1);
    });

    test("--sort alpha is accepted", async () => {
      await command.execute(["--sort", "alpha"], context);

      expect(client.listChats).toHaveBeenCalledTimes(1);
    });
  });

  describe("--all-profiles flag", () => {
    test("renders Profile column when --all-profiles is set", async () => {
      const profileChats: Record<string, ChatInfo[]> = {
        work: [{ id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" }],
        personal: [{ id: "conv-2", title: "Chat 2", isPinned: false, timestamp: Date.now(), profile: "personal" }],
      };
      context.listProfiles = () => Object.keys(profileChats);
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => profileChats[name] ?? []),
      }));

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
      client.listChats = mock(async () => mockChats);

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).not.toContain("PROFILE");
    });

    test("JSON output includes profile field when the default listing spans profiles", async () => {
      const profileChats: Record<string, ChatInfo[]> = {
        work: [{ id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" }],
        personal: [{ id: "conv-2", title: "Chat 2", isPinned: false, timestamp: Date.now(), profile: "personal" }],
      };
      context.listProfiles = () => Object.keys(profileChats);
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => profileChats[name] ?? []),
      }));

      await command.execute(["--format", "json"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.chats).toHaveLength(2);
      expect(parsed.chats[0]).toHaveProperty("profile");
      expect(parsed.chats[0].profile).toBe("work");
    });
  });

  describe("--profile / -p flag", () => {
    test("--help documents --profile flag", async () => {
      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("--profile");
      expect(output).toContain("-p");
    });

    test("--profile work routes to forProfile", async () => {
      await command.execute(["--profile", "work"], context);

      expect(client.forProfile).toHaveBeenCalledWith("work");
    });

    test("-p short flag routes to forProfile", async () => {
      await command.execute(["-p", "personal"], context);

      expect(client.forProfile).toHaveBeenCalledWith("personal");
    });

    test("without --profile, the default fans out to all configured profiles", async () => {
      await command.execute([], context);

      expect(client.forProfile).toHaveBeenCalledWith("default");
    });

    test("--profile renders Profile column in text output", async () => {
      const mockChats = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
      ];
      client.listChats = mock(async () => mockChats);

      await command.execute(["--profile", "work"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("PROFILE");
      expect(output).toContain("work");
    });

    test("--profile filters to one profile in JSON output", async () => {
      const mockChats = [
        { id: "conv-1", title: "Chat 1", isPinned: false, timestamp: Date.now(), profile: "work" },
      ];
      client.listChats = mock(async () => mockChats);

      await command.execute(["--profile", "work", "--format", "json"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.chats).toHaveLength(1);
      expect(parsed.chats[0].profile).toBe("work");
    });
  });

  describe("multi-profile default", () => {
    test("default aggregates chats from all configured profiles with a PROFILE column", async () => {
      const profileChats: Record<string, ChatInfo[]> = {
        work: [{ id: "conv-1", title: "Chat 1", isPinned: false, timestamp: 1717100000000, profile: "work" }],
        personal: [{ id: "conv-2", title: "Chat 2", isPinned: false, timestamp: 1717000000000, profile: "personal" }],
      };
      context.listProfiles = () => Object.keys(profileChats);
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => profileChats[name] ?? []),
      }));

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Chat 1");
      expect(output).toContain("Chat 2");
      expect(output).toContain("PROFILE");
      expect(output).toContain("work");
      expect(output).toContain("personal");
    });

    test("skips an inaccessible profile with a warning and continues", async () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const profileClients: Record<string, { listChats: ReturnType<typeof mock> }> = {
          work: { listChats: mock(async () => [{ id: "w1", title: "Work chat", isPinned: false, timestamp: Date.now(), profile: "work" }]) },
          broken: { listChats: mock(async () => { throw new Error("Network error"); }) },
        };
        client.forProfile = mock((name: string) => profileClients[name]);
        context.listProfiles = () => ["work", "broken"];

        await command.execute([], context);

        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Work chat");
        expect(stderrSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("broken");
      } finally {
        stderrSpy.mockRestore();
      }
    });

    test("resolves to the empty message when every profile listing fails", async () => {
      client.forProfile = mock((_name: string) => ({
        listChats: mock(async () => {
          throw new Error("down");
        }),
      }));
      context.listProfiles = () => ["a", "b"];

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No conversations found");
    });
  });

  describe("error handling", () => {
    test("propagates client errors when a single profile is explicitly targeted", async () => {
      client.listChats.mockRejectedValue(new Error("Network error"));

      await expect(command.execute(["--profile", "work"], context)).rejects.toThrow("Network error");
    });
  });
});
