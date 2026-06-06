import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ListCommand } from "../../src/cli/commands/list-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { QUERY_TYPES } from "../../src/core/query-handlers.ts";
import type { ListChatsQueryResult } from "../../src/core/query-handlers.ts";

const SAMPLE_CHATS = [
  { id: "abc123", title: "Python tips", isPinned: true, timestamp: 1717000000000 },
  { id: "def456", title: "Bun setup", isPinned: false, timestamp: 1717100000000 },
  { id: "ghi789", title: "Alpha test", isPinned: false, timestamp: 1716900000000 },
];

describe("ListCommand", () => {
  let command: ListCommand;
  let mediator: Mediator;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ListCommand();
    mediator = new Mediator();
    context = { verbose: false, mediator };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("list");
    expect(command.description).toBe("List conversations");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm list");
    expect(output).toContain("--limit");
    expect(output).toContain("--format");
  });

  test("sends list-chats query and displays results", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("abc123");
    expect(output).toContain("Python tips");
    expect(output).toContain("Total: 3 conversations");
  });

  test("applies limit", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--limit", "1"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Total: 1 conversation");
  });

  test("applies search filter", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => {
        const filtered = SAMPLE_CHATS.filter((c) => c.title.toLowerCase().includes("bun"));
        return { chats: filtered };
      }),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--search", "Bun"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ search: "Bun" }),
      }),
    );
  });

  test("applies --all flag", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--all"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Total: 3 conversations");
  });

  test("applies sort by alpha", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--sort", "alpha"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const alphaIdx = output.indexOf("Alpha test");
    const bunIdx = output.indexOf("Bun setup");
    const pythonIdx = output.indexOf("Python tips");
    expect(alphaIdx).toBeLessThan(bunIdx);
    expect(bunIdx).toBeLessThan(pythonIdx);
  });

  test("outputs JSON format", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--format", "json"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("chats");
    expect(parsed.chats).toHaveLength(3);
  });

  test("shows no conversations message when empty", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [] })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No conversations found");
  });

  test("applies --all-profiles flag in query", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: [] })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--all-profiles"], context);

    expect(mockHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ allProfiles: true }),
      }),
    );
  });

  test("applies --offset flag", async () => {
    const mockHandler = {
      queryType: QUERY_TYPES.LIST_CHATS,
      handle: mock(async () => ({ chats: SAMPLE_CHATS })),
    };
    mediator.registerQueryHandler(mockHandler as any);

    await command.execute(["--offset", "2", "--limit", "1"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ghi789");
    expect(output).toContain("Total: 1 conversation");
  });
});
