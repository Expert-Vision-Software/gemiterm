import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ExportAllCommand } from "../../src/cli/commands/export-all-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { QUERY_TYPES } from "../../src/core/query-handlers.ts";
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

describe("ExportAllCommand", () => {
  let command: ExportAllCommand;
  let mediator: Mediator;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let writeSpy: ReturnType<typeof spyOn>;
  let tempDir: string;

  beforeEach(() => {
    command = new ExportAllCommand();
    mediator = new Mediator();
    tempDir = join(tmpdir(), `export-all-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    context = { verbose: false, mediator };
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
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--out-dir", tempDir], context);

    const indexPath = join(tempDir, "index.md");
    expect(existsSync(indexPath)).toBeTrue();

    const indexContent = readFileSync(indexPath, "utf-8");
    expect(indexContent).toContain("Exported Conversations");
    expect(indexContent).toContain("Python tips");
    expect(indexContent).toContain("Bun setup");
  });

  test("creates individual export files for each chat", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--out-dir", tempDir], context);

    const files = readFileSync(join(tempDir, "index.md"), "utf-8");
    const mdFiles = files.match(/\.md\)/g);
    expect(mdFiles).toHaveLength(2);
  });

  test("shows no conversations message when empty", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [] })),
    };
    mediator.registerQueryHandler(listHandler as any);

    await command.execute(["--out-dir", tempDir], context);

    const output = capturedLog(logSpy);
    expect(output).toContain("No conversations found");
  });

  test("passes allProfiles flag to query", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--all-profiles", "--out-dir", tempDir], context);

    expect(listHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ allProfiles: true }),
      }),
    );
  });

  test("filters by --since date", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--since", "2024-01-01", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    const mdFiles = indexContent.match(/\.md\)/g);
    expect(mdFiles).toHaveLength(2);
  });

  test("reports failed exports in summary and index", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    let callCount = 0;
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => {
        callCount++;
        if (callCount === 1) return { messages: SAMPLE_MESSAGES };
        throw new Error("Network error");
      }),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--out-dir", tempDir], context);

    const output = capturedLog(logSpy);
    expect(output).toMatch(/Exported:\s+1/);
    expect(output).toMatch(/Failed:\s+1/);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Failed Exports");
    expect(indexContent).toContain("Network error");
  });

  test("shows progress output during export", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--out-dir", tempDir], context);

    const progressOutput = capturedStdout(writeSpy);
    expect(progressOutput).toContain("[1/2]");
    expect(progressOutput).toContain("[2/2]");
  });

  test("uses --include-metadata in index", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--include-metadata", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Successful:");
    expect(indexContent).toContain("Failed:");
  });

  test("defaults output directory to ./exports", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [] })),
    };
    mediator.registerQueryHandler(listHandler as any);

    await command.execute([], context);
    const output = capturedLog(logSpy);
    expect(output).toContain("No conversations found");
  });

  test("handles all exports failing", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => {
        throw new Error("boom");
      }),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

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
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [SAMPLE_CHATS[0]] })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => {
        throw "string-failure";
      }),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("string-failure");
  });

  test("creates the output directory when it does not exist", async () => {
    const nested = join(tempDir, "deep", "nested", "out");
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--out-dir", nested], context);

    expect(existsSync(nested)).toBeTrue();
    expect(existsSync(join(nested, "index.md"))).toBeTrue();
  });

  test("accepts -a short form for --all-profiles", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["-a", "--out-dir", tempDir], context);

    expect(listHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ allProfiles: true }),
      }),
    );
  });

  test("ignores invalid --since date and exports all chats", async () => {
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--since", "not-a-date", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("Python tips");
    expect(indexContent).toContain("Bun setup");
  });

  test("filters out chats older than --since date", async () => {
    const oldChat = { id: "old1", title: "Old chat", isPinned: false, timestamp: 1577836800000 };
    const newChat = { id: "new1", title: "New chat", isPinned: false, timestamp: 1717200000000 };
    const listHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [oldChat, newChat] })),
    };
    const fetchHandler = {
      queryType: QUERY_TYPES.FETCH_CHAT,
      handle: mock(async () => ({ messages: SAMPLE_MESSAGES })),
    };
    mediator.registerQueryHandler(listHandler as any);
    mediator.registerQueryHandler(fetchHandler as any);

    await command.execute(["--since", "2024-01-01", "--out-dir", tempDir], context);

    const indexContent = readFileSync(join(tempDir, "index.md"), "utf-8");
    expect(indexContent).toContain("New chat");
    expect(indexContent).not.toContain("Old chat");
  });
});
