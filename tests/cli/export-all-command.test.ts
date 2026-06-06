import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ExportAllCommand } from "../../src/cli/commands/export-all-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { QUERY_TYPES } from "../../src/core/query-handlers.ts";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SAMPLE_CHATS = [
  { id: "abc123", title: "Python tips", isPinned: true, timestamp: 1717000000000 },
  { id: "def456", title: "Bun setup", isPinned: false, timestamp: 1717100000000 },
];

const SAMPLE_MESSAGES = [
  { role: "user" as const, content: "Hello" },
  { role: "model" as const, content: "Hi there!" },
];

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
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm export-all");
    expect(output).toContain("--output-dir");
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

    await command.execute(["--output-dir", tempDir], context);

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

    await command.execute(["--output-dir", tempDir], context);

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

    await command.execute(["--output-dir", tempDir], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
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

    await command.execute(["--all-profiles", "--output-dir", tempDir], context);

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

    await command.execute(["--since", "2024-01-01", "--output-dir", tempDir], context);

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

    await command.execute(["--output-dir", tempDir], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Exported: 1");
    expect(output).toContain("Failed:  1");

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

    await command.execute(["--output-dir", tempDir], context);

    const progressOutput = writeSpy.mock.calls.map((c) => c[0]).join("");
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

    await command.execute(["--include-metadata", "--output-dir", tempDir], context);

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
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No conversations found");
  });
});
