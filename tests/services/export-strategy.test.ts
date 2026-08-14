import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import {
  formatConversation,
  filenameFor,
  SingleExport,
  BatchExport,
  type ExportResult,
} from "../../src/services/export-strategy.ts";
import { formatChatAsMarkdown, formatChatAsJson } from "../../src/infrastructure/formatters.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { ChatInfo, Message } from "../../src/core/types.ts";
import { mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAMPLE_MESSAGES: Message[] = [
  { role: "user", content: "Hello" },
  { role: "model", content: "Hi there!" },
];

const SAMPLE_CHATS: ChatInfo[] = [
  { id: "abc123", title: "Python tips", isPinned: true, timestamp: 1717000000000 },
  { id: "def456", title: "Bun setup", isPinned: false, timestamp: 1717100000000 },
];

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

function capturedLog(spy: ReturnType<typeof spyOn>): string {
  return stripAnsi(spy.mock.calls.map((c) => c[0]).join("\n"));
}

describe("formatConversation", () => {
  test("markdown delegation is byte-identical to formatChatAsMarkdown", () => {
    const direct = formatChatAsMarkdown(SAMPLE_MESSAGES, "My Title", "conv-123", false);
    const via = formatConversation({
      messages: SAMPLE_MESSAGES,
      title: "My Title",
      conversationId: "conv-123",
      format: "markdown",
      includeMetadata: false,
    });
    expect(via).toBe(direct);
  });

  test("markdown with includeMetadata embeds the metadata header", () => {
    const via = formatConversation({
      messages: SAMPLE_MESSAGES,
      title: "My Title",
      conversationId: "conv-123",
      format: "markdown",
      includeMetadata: true,
    });
    expect(via).toContain("> Conversation ID: conv-123");
    expect(via).toContain(`> Messages: ${SAMPLE_MESSAGES.length}`);
  });

  test("json delegation is byte-identical to formatChatAsJson and ignores title/metadata", () => {
    const direct = formatChatAsJson(SAMPLE_MESSAGES, "conv-123");
    const via = formatConversation({
      messages: SAMPLE_MESSAGES,
      title: "Ignored Title",
      conversationId: "conv-123",
      format: "json",
      includeMetadata: true,
    });
    expect(via).toBe(direct);
  });
});

describe("filenameFor", () => {
  test("single filename uses the id and a format-aware extension", () => {
    expect(filenameFor({ kind: "single", conversationId: "conv-abc123", format: "json" })).toMatch(
      /^gemini-chat-conv-abc123-\d{4}-\d{2}-\d{2}\.json$/,
    );
    expect(filenameFor({ kind: "single", conversationId: "conv-abc123", format: "markdown" })).toMatch(
      /^gemini-chat-conv-abc123-\d{4}-\d{2}-\d{2}\.md$/,
    );
  });

  test("batch filename sanitizes the title", () => {
    const name = filenameFor({ kind: "batch", title: `What's new? A/B "test"` });
    expect(name).toMatch(/^gemini-chat-.+-\d{4}-\d{2}-\d{2}\.md$/);
    expect(name).not.toMatch(/[\/\\?%*:|"<>\s]/);
  });

  test("batch filename truncates the sanitized title to 60 characters", () => {
    const name = filenameFor({ kind: "batch", title: "a".repeat(100) });
    const base = name.replace(/^gemini-chat-/, "").replace(/-\d{4}-\d{2}-\d{2}\.md$/, "");
    expect(base.length).toBeLessThanOrEqual(60);
  });

  test("batch filename strips trailing dashes", () => {
    const name = filenameFor({ kind: "batch", title: "Trailing Space " });
    expect(name).toMatch(/-\d{4}-\d{2}-\d{2}\.md$/);
  });
});

describe("SingleExport", () => {
  test("exports one conversation to one file and returns a single ExportResult", async () => {
    const out = join(tmpdir(), `single-export-${Date.now()}.md`);
    const single = new SingleExport({
      fetchChat: mock(async () => SAMPLE_MESSAGES),
      logger: new Logger("test"),
    });

    const results = await single.export(
      { kind: "single", conversationId: "conv-abc123", messages: SAMPLE_MESSAGES, format: "markdown", out },
      { includeMetadata: false },
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].filePath).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf-8")).toContain("# conv-abc123");
    rmSync(out, { force: true });
  });

  test("exportMany fetches each id and writes N files under outDir", async () => {
    const outDir = join(tmpdir(), `single-many-${Date.now()}`);
    const single = new SingleExport({
      fetchChat: mock(async (id: string) => [{ role: "user", content: `content-${id}` }]),
      logger: new Logger("test"),
    });

    const results = await single.export(
      { kind: "single", conversationId: "", messages: [], format: "markdown", conversationIds: ["id1", "id2"], outDir },
      {},
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(readdirSync(outDir)).toHaveLength(2);
    rmSync(outDir, { recursive: true, force: true });
  });

  test("exportMany records a failing id and continues", async () => {
    const outDir = join(tmpdir(), `single-many-fail-${Date.now()}`);
    const single = new SingleExport({
      fetchChat: mock(async (id: string) => {
        if (id === "bad") throw new Error("boom");
        return [{ role: "user", content: `content-${id}` }];
      }),
      logger: new Logger("test"),
    });

    const results = await single.export(
      { kind: "single", conversationId: "", messages: [], format: "markdown", conversationIds: ["good", "bad"], outDir },
      {},
    );

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === "good")?.success).toBe(true);
    const bad = results.find((r) => r.id === "bad");
    expect(bad?.success).toBe(false);
    expect(bad?.error).toBe("boom");
    rmSync(outDir, { recursive: true, force: true });
  });
});

describe("BatchExport", () => {
  let batch: BatchExport;
  let tempDir: string;
  let logSpy: ReturnType<typeof spyOn>;
  let writeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `batch-export-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
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

  function makeBatch(listProfiles: () => string[], listChatsForProfile?: (name: string) => Promise<ChatInfo[]>) {
    return new BatchExport({
      fetchChat: mock(async () => SAMPLE_MESSAGES),
      listChatsForProfile: listChatsForProfile
        ? mock(async (name: string) => listChatsForProfile(name))
        : mock(async () => []),
      listProfiles,
      logger: new Logger("test"),
    });
  }

  test("exports many conversations to a directory with index.md", async () => {
    const outDir = join(tempDir, "exports");
    const batch = makeBatch(() => []);

    const results = await batch.export({ kind: "batch", chats: SAMPLE_CHATS, outDir });

    expect(results).toHaveLength(2);
    expect(existsSync(join(outDir, "index.md"))).toBe(true);
    const indexContent = readFileSync(join(outDir, "index.md"), "utf-8");
    expect(indexContent).toContain("# Exported Conversations");
    expect(indexContent).toContain("Python tips");
    expect(indexContent).toContain("Bun setup");
  });

  test("records a failing chat and continues with the rest", async () => {
    const outDir = join(tempDir, "exports");
    const batch = new BatchExport({
      fetchChat: mock(async (id: string) => {
        if (id === "def456") throw new Error("Network error");
        return SAMPLE_MESSAGES;
      }),
      listChatsForProfile: mock(async () => []),
      listProfiles: () => [],
      logger: new Logger("test"),
    });

    const results = await batch.export({ kind: "batch", chats: SAMPLE_CHATS, outDir });

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === "abc123")?.success).toBe(true);
    const failed = results.find((r) => r.id === "def456");
    expect(failed?.success).toBe(false);
    expect(failed?.error).toBe("Network error");

    const indexContent = readFileSync(join(outDir, "index.md"), "utf-8");
    expect(indexContent).toContain("## Failed Exports");
    expect(indexContent).toContain("Network error");

    const summary = capturedLog(logSpy);
    expect(summary).toMatch(/Exported:\s+1/);
    expect(summary).toMatch(/Failed:\s+1/);
  });

  test("per-profile listing warns and continues when one profile fails", async () => {
    const outDir = join(tempDir, "exports");
    const batch = new BatchExport({
      fetchChat: mock(async () => SAMPLE_MESSAGES),
      listChatsForProfile: mock(async (name: string) => {
        if (name === "broken") throw new Error("unavailable");
        return [{ id: `${name}-1`, title: `${name} chat`, isPinned: false, timestamp: 1717000000000 }];
      }),
      listProfiles: () => ["work", "broken", "personal"],
      logger: new Logger("test"),
    });

    const results = await batch.export(
      { kind: "batch", chats: [], outDir },
      { allProfiles: true },
    );

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.id === "work-1")).toBe(true);
    expect(results.some((r) => r.id === "personal-1")).toBe(true);
    expect(results.some((r) => r.id === "broken-1")).toBe(false);
  });

  test("all profiles failing completes with the empty-list message", async () => {
    const outDir = join(tempDir, "exports");
    const batch = new BatchExport({
      fetchChat: mock(async () => SAMPLE_MESSAGES),
      listChatsForProfile: mock(async () => {
        throw new Error("unavailable");
      }),
      listProfiles: () => ["a", "b"],
      logger: new Logger("test"),
    });

    const results = await batch.export({ kind: "batch", chats: [], outDir }, { allProfiles: true });

    expect(results).toEqual([]);
    expect(capturedLog(logSpy)).toContain("No conversations found to export");
  });

  test("module imports no src/cli path", () => {
    const src = readFileSync(join(import.meta.dir, "../../src/services/export-strategy.ts"), "utf-8");
    expect(src).not.toContain("src/cli");
    expect(src).not.toContain("gemini-queries");
    expect(src).not.toContain("GeminiClientService");
  });
});
