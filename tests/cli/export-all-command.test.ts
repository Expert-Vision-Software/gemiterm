import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ExportAllCommand } from "../../src/cli/commands/export-all-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import type { ChatInfo, Message } from "../../src/core/types.ts";
import { SingleExport, BatchExport } from "../../src/services/export-strategy.ts";
import { fetchChatForRequest } from "../../src/cli/utils/gemini-queries.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAMPLE_CHATS = [
  { id: "abc123", title: "Python tips", isPinned: true, timestamp: 1717000000000 },
  { id: "def456", title: "Bun setup", isPinned: false, timestamp: 1717100000000 },
];

const SAMPLE_MESSAGES = [
  { role: "user" as const, content: "Hello" },
  { role: "model" as const, content: "Hi there!" },
];

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

function capturedLog(spy: ReturnType<typeof spyOn>): string {
  return stripAnsi(spy.mock.calls.map((c) => c[0]).join("\n"));
}

function capturedStdout(spy: ReturnType<typeof spyOn>): string {
  return stripAnsi(spy.mock.calls.map((c) => c[0]).join(""));
}

function makeClient() {
  const client: any = {
    listChats: mock(async (_opts?: any): Promise<ChatInfo[]> => []),
    fetchChat: mock(async (_id: string): Promise<Message[]> => []),
    deleteChat: mock(async (_id: string): Promise<void> => {}),
    sendMessage: mock(async (_id: string, _msg: string): Promise<string> => ""),
    startNewChat: mock(async (_msg: string): Promise<{ response: string; conversationId: string }> => ({ response: "", conversationId: "" })),
    listModels: mock(async (): Promise<string[]> => []),
    profileHasConversation: mock(async (_name: string, _id: string): Promise<boolean> => false),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("ExportAllCommand", () => {
  let command: ExportAllCommand;
  let client: any;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let writeSpy: ReturnType<typeof spyOn>;
  let tempDir: string;

  beforeEach(() => {
    command = new ExportAllCommand();
    client = makeClient();
    tempDir = join(tmpdir(), `export-all-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    context = {
      verbose: false,
      profileAuthManager: {} as CliCommandContext["profileAuthManager"],
      getGeminiClient: () => client,
      listProfiles: () => [],
      exportStrategies: {
        single: new SingleExport({
          fetchChat: (id, profile) => fetchChatForRequest(() => client, id, profile),
          logger: new Logger("test"),
        }),
        batch: new BatchExport({
          fetchChat: (id, profile) => fetchChatForRequest(() => client, id, profile),
          listChatsForProfile: (name, opts) => client.forProfile(name).listChats(opts),
          listProfiles: () => context.listProfiles(),
          logger: new Logger("test"),
        }),
      },
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    writeSpy.mockRestore();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("export-all");
    expect(command.description).toBe("Export all conversations to files");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = capturedLog(logSpy);
    expect(output).toContain("Usage: gemiterm export-all");
    expect(output).toContain("--out-dir");
    expect(output).toContain("--since");
    expect(output).toContain("--all-profiles");
  });

  test("exports all chats and creates index.md", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--out-dir", tempDir], context);

    const indexPath = join(tempDir, "index.md");
    expect(existsSync(indexPath)).toBeTrue();

    const indexContent = readFileSync(indexPath, "utf-8");
    expect(indexContent).toContain("Exported Conversations");
    expect(indexContent).toContain("Python tips");
    expect(indexContent).toContain("Bun setup");
  });

  test("creates individual export files for each chat", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--out-dir", tempDir], context);

    const files = readFileSync(join(tempDir, "index.md"), "utf-8");
    const mdFiles = files.match(/\.md\)/g);
    expect(mdFiles).toHaveLength(2);
  });

  test("shows no conversations message when empty", async () => {
    client.listChats = mock(async () => []);

    await command.execute(["--out-dir", tempDir], context);

    const output = capturedLog(logSpy);
    expect(output).toContain("No conversations found");
  });

  test("passes allProfiles flag to query", async () => {
    context.listProfiles = () => ["default"];
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--all-profiles", "--out-dir", tempDir], context);

    expect(client.forProfile).toHaveBeenCalledWith("default");
  });

  test("filters by --since date", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--since", "2024-01-01", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    const mdFiles = indexContent.match(/\.md\)/g);
    expect(mdFiles).toHaveLength(2);
  });

  test("reports failed exports in summary and index", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    let callCount = 0;
    client.fetchChat = mock(async () => {
      callCount++;
      if (callCount === 1) return SAMPLE_MESSAGES;
      throw new Error("Network error");
    });

    await command.execute(["--out-dir", tempDir], context);

    const output = capturedLog(logSpy);
    expect(output).toMatch(/Exported:\s+1/);
    expect(output).toMatch(/Failed:\s+1/);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Failed Exports");
    expect(indexContent).toContain("Network error");
  });

  test("shows progress output during export", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--out-dir", tempDir], context);

    const progressOutput = capturedStdout(writeSpy);
    expect(progressOutput).toContain("[1/2]");
    expect(progressOutput).toContain("[2/2]");
  });

  test("uses --include-metadata in index", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--include-metadata", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Successful:");
    expect(indexContent).toContain("Failed:");
  });

  test("defaults output directory to ./exports", async () => {
    client.listChats = mock(async () => []);

    await command.execute([], context);
    const output = capturedLog(logSpy);
    expect(output).toContain("No conversations found");
  });

  test("handles all exports failing", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => {
      throw new Error("boom");
    });

    await command.execute(["--out-dir", tempDir], context);

    const output = capturedLog(logSpy);
    expect(output).toMatch(/Exported:\s+0/);
    expect(output).toMatch(/Failed:\s+2/);
    expect(output).toMatch(/Index:/);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Failed Exports");
    expect(indexContent).toContain("Python tips");
    expect(indexContent).toContain("Bun setup");
    expect(indexContent).toContain("boom");
  });

  test("preserves non-Error throw values in failure output", async () => {
    client.listChats = mock(async () => [SAMPLE_CHATS[0]]);
    client.fetchChat = mock(async () => {
      throw "string-failure";
    });

    await command.execute(["--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("string-failure");
  });

  test("creates the output directory when it does not exist", async () => {
    const nested = join(tempDir, "deep", "nested", "out");
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--out-dir", nested], context);

    expect(existsSync(nested)).toBeTrue();
    expect(existsSync(join(nested, "index.md"))).toBeTrue();
  });

  test("accepts -a short form for --all-profiles", async () => {
    context.listProfiles = () => ["default"];
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["-a", "--out-dir", tempDir], context);

    expect(client.forProfile).toHaveBeenCalledWith("default");
  });

  test("ignores invalid --since date and exports all chats", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--since", "not-a-date", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Python tips");
    expect(indexContent).toContain("Bun setup");
  });

  test("filters out chats older than --since date", async () => {
    const oldChat = { id: "old1", title: "Old chat", isPinned: false, timestamp: 1577836800000 };
    const newChat = { id: "new1", title: "New chat", isPinned: false, timestamp: 1717200000000 };
    client.listChats = mock(async () => [oldChat, newChat]);
    client.fetchChat = mock(async () => SAMPLE_MESSAGES);

    await command.execute(["--since", "2024-01-01", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("New chat");
    expect(indexContent).not.toContain("Old chat");
  });

  test("forwards chat.profile into FETCH_CHAT payload for non-default profiles", async () => {
    const evsChat = { id: "evs-1", title: "EVS chat", isPinned: false, timestamp: 1717000000000, profile: "evs-diegohb" };
    const dhbChat = { id: "dhb-1", title: "DHB chat", isPinned: false, timestamp: 1717100000000, profile: "dhb-work" };
    const profileClients: Record<string, any> = {
      "evs-diegohb": {
        listChats: mock(async () => [evsChat]),
        fetchChat: mock(async () => SAMPLE_MESSAGES),
      },
      "dhb-work": {
        listChats: mock(async () => [dhbChat]),
        fetchChat: mock(async () => SAMPLE_MESSAGES),
      },
    };
    client.forProfile = mock((name: string) => profileClients[name]);
    context.listProfiles = () => ["evs-diegohb", "dhb-work"];

    await command.execute(["--all-profiles", "--out-dir", tempDir], context);

    expect(profileClients["evs-diegohb"].fetchChat).toHaveBeenCalledWith("evs-1");
    expect(profileClients["dhb-work"].fetchChat).toHaveBeenCalledWith("dhb-1");
  });
});
