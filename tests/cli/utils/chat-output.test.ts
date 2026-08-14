import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import {
  render,
  sortChats,
  filterChatsByDate,
  type RenderStrategies,
} from "../../../src/cli/utils/chat-output.ts";
import type { ChatInfo, Message } from "../../../src/core/types.ts";
import * as ioModule from "../../../src/infrastructure/io.ts";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CHATS: ChatInfo[] = [
  { id: "c1", title: "Alpha", isPinned: false, timestamp: 1717000000000 },
  { id: "c2", title: "Charlie", isPinned: true, timestamp: 1717100000000 },
  { id: "c3", title: "Bravo", isPinned: false, timestamp: 1716900000000 },
];

const MESSAGES: Message[] = [
  { role: "user", content: "Hello" },
  { role: "model", content: "Hi there!" },
];

function makeStrategies(): RenderStrategies {
  const single = {
    export: mock(async () => [{ id: "x", title: "x", filePath: "out.md", success: true }]),
  };
  const batch = {
    export: mock(async () => [{ id: "x", title: "x", filePath: "out.md", success: true }]),
  };
  return { single, batch } as unknown as RenderStrategies;
}

describe("sortChats", () => {
  test("recent sorts by descending timestamp", () => {
    expect(sortChats(CHATS, "recent").map((c) => c.id)).toEqual(["c2", "c1", "c3"]);
  });

  test("oldest sorts by ascending timestamp", () => {
    expect(sortChats(CHATS, "oldest").map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
  });

  test("alpha sorts ascending by title", () => {
    expect(sortChats(CHATS, "alpha").map((c) => c.id)).toEqual(["c1", "c3", "c2"]);
  });

  test("does not mutate its input", () => {
    const input = [...CHATS];
    sortChats(input, "alpha");
    expect(input).toEqual(CHATS);
  });
});

describe("filterChatsByDate", () => {
  const chats: ChatInfo[] = [
    { id: "old", title: "Old", isPinned: false, timestamp: Date.parse("2023-06-01T00:00:00Z") },
    { id: "mid", title: "Mid", isPinned: false, timestamp: Date.parse("2024-06-01T00:00:00Z") },
    { id: "new", title: "New", isPinned: false, timestamp: Date.parse("2025-06-01T00:00:00Z") },
  ];

  test("after/before filters inclusively", () => {
    const result = filterChatsByDate(chats, { after: "2024-01-01", before: "2024-12-31" });
    expect(result.map((c) => c.id)).toEqual(["mid"]);
  });

  test("invalid after string leaves the bound unfiltered", () => {
    expect(filterChatsByDate(chats, { after: "not-a-date" })).toEqual(chats);
  });

  test("invalid before string leaves the bound unfiltered", () => {
    expect(filterChatsByDate(chats, { before: "not-a-date" })).toEqual(chats);
  });

  test("since filters on-or-after", () => {
    const result = filterChatsByDate(chats, { since: "2024-01-01" });
    expect(result.map((c) => c.id)).toEqual(["mid", "new"]);
  });

  test("invalid since leaves the list unfiltered", () => {
    expect(filterChatsByDate(chats, { since: "not-a-date" })).toEqual(chats);
  });

  test("missing bounds return the list unfiltered", () => {
    expect(filterChatsByDate(chats, {})).toEqual(chats);
  });

  test("does not mutate its input", () => {
    const input = [...chats];
    filterChatsByDate(input, { since: "2024-01-01" });
    expect(input).toEqual(chats);
  });
});

describe("render dispatch", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
  });

  test("chat-list without out prints the table to stdout", async () => {
    await render({ kind: "chat-list", chats: CHATS, includeProfileColumn: false }, { format: "text" });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ID");
    expect(output).toContain("Alpha");
    expect(output).toContain("Total: 3 conversations");
  });

  test("chat-list with out writes the file and prints the confirmation", async () => {
    const dir = join(tmpdir(), `chat-output-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, "out.txt");
    try {
      await render({ kind: "chat-list", chats: CHATS, includeProfileColumn: false }, { format: "text", out });

      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, "utf-8")).toContain("Alpha");
      expect(logSpy.mock.calls.map((c) => c[0]).join("\n")).toContain(`Output written to: ${out}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("chat-list json reproduces the { chats } document", async () => {
    await render({ kind: "chat-list", chats: CHATS, includeProfileColumn: false }, { format: "json" });

    const parsed = JSON.parse(logSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(parsed).toHaveProperty("chats");
    expect(parsed.chats).toHaveLength(3);
  });

  test("chat-list with includeProfileColumn delegates to the 5-column form", async () => {
    const profiled = [{ ...CHATS[0], profile: "work" }];
    await render({ kind: "chat-list", chats: profiled, includeProfileColumn: true }, { format: "text" });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("PROFILE");
    expect(output).toContain("work");
  });

  test("conversation text reproduces the Conversation / User / Model shape", async () => {
    await render({ kind: "conversation", conversationId: "conv-1", messages: MESSAGES }, { format: "text" });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Conversation:");
    expect(output).toContain("conv-1");
    expect(output).toContain("User:");
    expect(output).toContain("Model:");
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  test("conversation text with empty messages prints the empty message", async () => {
    await render({ kind: "conversation", conversationId: "conv-empty", messages: [] }, { format: "text" });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No messages found");
  });

  test("conversation json reproduces the { conversationId, messages } document", async () => {
    await render({ kind: "conversation", conversationId: "conv-1", messages: MESSAGES }, { format: "json" });

    const parsed = JSON.parse(logSpy.mock.calls.map((c) => c[0]).join("\n"));
    expect(parsed).toEqual({ conversationId: "conv-1", messages: MESSAGES });
  });
});

describe("render export forwarding", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let writeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    writeSpy = spyOn(ioModule, "writeTextFile").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  test("conversation markdown forwards to the single strategy", async () => {
    const strategies = makeStrategies();
    const singleExport = (strategies.single as any).export;

    await render(
      { kind: "conversation", conversationId: "conv-1", messages: MESSAGES, includeMetadata: true },
      { format: "markdown", out: "out.md" },
      strategies,
    );

    expect(singleExport).toHaveBeenCalledTimes(1);
    expect(singleExport.mock.calls[0][0]).toMatchObject({
      kind: "single",
      conversationId: "conv-1",
      format: "markdown",
      out: "out.md",
    });
    expect(singleExport.mock.calls[0][1]).toEqual({ includeMetadata: true });
  });

  test("conversation json with strategies forwards to the single strategy", async () => {
    const strategies = makeStrategies();
    const singleExport = (strategies.single as any).export;

    await render(
      { kind: "conversation", conversationId: "conv-1", messages: MESSAGES },
      { format: "json", out: "out.json" },
      strategies,
    );

    expect(singleExport).toHaveBeenCalledTimes(1);
    expect(singleExport.mock.calls[0][0]).toMatchObject({ kind: "single", format: "json" });
  });

  test("batch-export forwards to the batch strategy without inline formatting", async () => {
    const strategies = makeStrategies();
    const batchExport = (strategies.batch as any).export;

    await render(
      {
        kind: "batch-export",
        chats: CHATS,
        outDir: "./exports",
        since: "2024-01-01",
        allProfiles: true,
        includeMetadata: false,
      },
      { format: "markdown" },
      strategies,
    );

    expect(batchExport).toHaveBeenCalledTimes(1);
    expect(batchExport.mock.calls[0][0]).toMatchObject({ kind: "batch", chats: CHATS, outDir: "./exports" });
    expect(batchExport.mock.calls[0][1]).toEqual({
      since: "2024-01-01",
      allProfiles: true,
      includeMetadata: false,
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
