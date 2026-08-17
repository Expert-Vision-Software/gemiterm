import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ListCommand } from "../../src/cli/commands/list-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { NonInteractiveError } from "../../src/cli/utils/prompts.ts";
import { GemitermError } from "../../src/core/errors.ts";
import type { ChatInfo } from "../../src/core/types.ts";

const SAMPLE_CHATS = [
  { id: "abc123", title: "Python tips", isPinned: true, timestamp: 1717000000000 },
  { id: "def456", title: "Bun setup", isPinned: false, timestamp: 1717100000000 },
  { id: "ghi789", title: "Alpha test", isPinned: false, timestamp: 1716900000000 },
];

function makeClient() {
  const client: any = {
    listChats: mock(async (_opts?: any): Promise<ChatInfo[]> => []),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("ListCommand", () => {
  let command: ListCommand;
  let client: ReturnType<typeof makeClient>;
  let context: CliCommandContext;
  let cookieSession: { probe: ReturnType<typeof mock>; recover: ReturnType<typeof mock> };
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ListCommand();
    client = makeClient();
    cookieSession = {
      probe: mock(async () => "live" as const),
      recover: mock(async () => ({})),
      createKeepalive: mock(() => ({ start: mock(() => {}), stop: mock(() => {}) })),
    };
    context = {
      verbose: false,
      cookieSession: cookieSession as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => ["default"],
    };
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
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("abc123");
    expect(output).toContain("Python tips");
    expect(output).toContain("Total: 3 conversations");
    expect(cookieSession.createKeepalive).not.toHaveBeenCalled();
  });

  test("applies limit", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute(["--limit", "1"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Total: 1 conversation");
  });

  test("applies search filter", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute(["--search", "Bun"], context);

    expect(client.listChats).toHaveBeenCalledWith(
      expect.objectContaining({ search: "Bun" }),
    );
  });

  test("returns all conversations by default (no limit)", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Total: 3 conversations");
    const sentOptions = client.listChats.mock.calls[0][0] as any;
    expect(sentOptions.limit).toBeUndefined();
  });

  test("applies --limit to restrict results", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute(["--limit", "1"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Total: 1 conversation");
    const sentOptions = client.listChats.mock.calls[0][0] as any;
    expect(sentOptions.limit).toBe(1);
  });

  test("applies sort by alpha", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute(["--sort", "alpha"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const alphaIdx = output.indexOf("Alpha test");
    const bunIdx = output.indexOf("Bun setup");
    const pythonIdx = output.indexOf("Python tips");
    expect(alphaIdx).toBeLessThan(bunIdx);
    expect(bunIdx).toBeLessThan(pythonIdx);
  });

  test("outputs JSON format", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute(["--format", "json"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("chats");
    expect(parsed.chats).toHaveLength(3);
  });

  test("shows no conversations message when empty", async () => {
    client.listChats = mock(async () => []);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No conversations found");
  });

  test("empty single-profile default probes the sole configured profile", async () => {
    client.listChats = mock(async () => []);

    await command.execute([], context);

    expect(cookieSession.probe).toHaveBeenCalledTimes(1);
    expect(cookieSession.probe).toHaveBeenCalledWith("default");
  });

  test("applies --all-profiles flag in query", async () => {
    client.listChats = mock(async () => []);
    context.listProfiles = () => ["work", "personal"];

    await command.execute(["--all-profiles"], context);

    expect(client.forProfile).toHaveBeenCalledWith("work");
    expect(client.forProfile).toHaveBeenCalledWith("personal");
  });

  test("applies --profile flag in query", async () => {
    client.listChats = mock(async () => []);

    await command.execute(["--profile", "work"], context);

    expect(client.forProfile).toHaveBeenCalledWith("work");
  });

  test("applies -p short flag in query", async () => {
    client.listChats = mock(async () => []);

    await command.execute(["-p", "personal"], context);

    expect(client.forProfile).toHaveBeenCalledWith("personal");
  });

  test("fans out to all configured profiles when no profile is specified", async () => {
    client.listChats = mock(async () => []);

    await command.execute([], context);

    expect(client.forProfile).toHaveBeenCalledWith("default");
    expect(client.listChats).toHaveBeenCalled();
  });

  test("applies --offset flag", async () => {
    client.listChats = mock(async () => SAMPLE_CHATS);

    await command.execute(["--offset", "2", "--limit", "1"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ghi789");
    expect(output).toContain("Total: 1 conversation");
  });

  test("default aggregates all configured profiles", async () => {
    const profileClients: Record<string, { listChats: ReturnType<typeof mock> }> = {
      work: { listChats: mock(async () => [{ id: "w1", title: "Work chat", isPinned: false, timestamp: 1717100000000, profile: "work" }]) },
      personal: { listChats: mock(async () => [{ id: "p1", title: "Personal chat", isPinned: false, timestamp: 1717000000000, profile: "personal" }]) },
    };
    client.forProfile = mock((name: string) => profileClients[name]);
    context.listProfiles = () => ["work", "personal"];

    await command.execute([], context);

    expect(client.forProfile).toHaveBeenCalledWith("work");
    expect(client.forProfile).toHaveBeenCalledWith("personal");
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Work chat");
    expect(output).toContain("Personal chat");
    expect(output).toContain("PROFILE");
    expect(output).toContain("work");
    expect(output).toContain("personal");
  });

  test("--profile scopes to the named profile without fan-out to other profiles", async () => {
    const profileClients: Record<string, { listChats: ReturnType<typeof mock> }> = {
      work: { listChats: mock(async () => [{ id: "w1", title: "Work chat", isPinned: false, timestamp: 1717100000000, profile: "work" }]) },
      personal: { listChats: mock(async () => [{ id: "p1", title: "Personal chat", isPinned: false, timestamp: 1717000000000, profile: "personal" }]) },
    };
    client.forProfile = mock((name: string) => profileClients[name]);
    context.listProfiles = () => ["work", "personal"];

    await command.execute(["--profile", "work"], context);

    expect(client.forProfile).toHaveBeenCalledWith("work");
    expect(client.forProfile).not.toHaveBeenCalledWith("personal");
    expect(profileClients.personal.listChats).not.toHaveBeenCalled();
  });
});

describe("ListCommand --interactive flag", () => {
  let command: ListCommand;
  let client: ReturnType<typeof makeClient>;
  let context: CliCommandContext;
  let cookieSession: { probe: ReturnType<typeof mock>; recover: ReturnType<typeof mock> };
  let logSpy: ReturnType<typeof spyOn>;
  let promptsModule: typeof import("../../src/cli/utils/prompts.ts");

  beforeEach(async () => {
    command = new ListCommand();
    client = makeClient();
    cookieSession = {
      probe: mock(async () => "live" as const),
      recover: mock(async () => ({})),
    };
    context = {
      verbose: false,
      cookieSession: cookieSession as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => ["default"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    promptsModule = await import("../../src/cli/utils/prompts.ts");
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
  });

  test("help documents --interactive flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--interactive");
    expect(output).toContain("-i");
  });

  test("--interactive enters the TUI when TTY and chat is picked then quit", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    const browserSpy = spyOn(promptsModule, "browser").mockResolvedValue({
      kind: "quit",
    } as any);
    const selectSpy = spyOn(promptsModule, "select").mockResolvedValue(undefined as any);

    client.listChats = mock(async () => SAMPLE_CHATS);

    try {
      await command.execute(["--interactive"], context);
      expect(browserSpy).toHaveBeenCalledTimes(1);
      const callArg = browserSpy.mock.calls[0][0] as any;
      expect(callArg.chats).toEqual(
        [...SAMPLE_CHATS].sort((a, b) => b.timestamp - a.timestamp),
      );
      expect(selectSpy).not.toHaveBeenCalled();
      expect(client.forProfile).toHaveBeenCalled();
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  test("--interactive -i short flag also enables allProfiles by default", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    const browserSpy = spyOn(promptsModule, "browser").mockResolvedValue({
      kind: "quit",
    } as any);

    client.listChats = mock(async () => SAMPLE_CHATS);

    try {
      await command.execute(["-i"], context);
      expect(browserSpy).toHaveBeenCalledTimes(1);
      expect(client.forProfile).toHaveBeenCalled();
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  test("--interactive -i short flag is equivalent", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    const browserSpy = spyOn(promptsModule, "browser").mockResolvedValue({
      kind: "quit",
    } as any);

    client.listChats = mock(async () => SAMPLE_CHATS);

    try {
      await command.execute(["-i"], context);
      expect(browserSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  test("--interactive --sort pre-selects the sort", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    const browserSpy = spyOn(promptsModule, "browser").mockResolvedValue({
      kind: "quit",
    } as any);

    client.listChats = mock(async () => SAMPLE_CHATS);

    try {
      await command.execute(["--interactive", "--sort", "alpha"], context);
      const callArg = browserSpy.mock.calls[0][0] as any;
      expect(callArg.initialSort).toBe("alpha");
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  test("--interactive --profile work does not force allProfiles", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });

    const browserSpy = spyOn(promptsModule, "browser").mockResolvedValue({
      kind: "quit",
    } as any);

    client.listChats = mock(async () => SAMPLE_CHATS);

    try {
      await command.execute(["-i", "--profile", "work"], context);
      expect(client.forProfile).toHaveBeenCalledWith("work");
      expect(browserSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  test("--interactive throws NonInteractiveError when not a TTY", async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });

    client.listChats = mock(async () => SAMPLE_CHATS);

    try {
      await expect(command.execute(["--interactive"], context)).rejects.toBeInstanceOf(
        NonInteractiveError,
      );
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });

  test("--interactive --format json throws GemitermError", async () => {
    await expect(command.execute(["--interactive", "--format", "json"], context)).rejects.toThrow(
      GemitermError,
    );

    try {
      await command.execute(["--interactive", "--format", "json"], context);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain(
        "Cannot use --interactive with --format or --out.",
      );
    }
  });

  test("--interactive --out out.txt throws GemitermError", async () => {
    try {
      await command.execute(["--interactive", "--out", "out.txt"], context);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GemitermError);
      expect((error as Error).message).toContain(
        "Cannot use --interactive with --format or --out.",
      );
    }
  });

  describe("action menu (single-pick dispatch)", () => {
    let deleteExecute: ReturnType<typeof mock>;
    let exportExecute: ReturnType<typeof mock>;
    let fetchExecute: ReturnType<typeof mock>;
    let freshChats: ChatInfo[];

    const stdinTty = (): PropertyDescriptor | undefined =>
      Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const setStdinTty = (value: boolean): void => {
      Object.defineProperty(process.stdin, "isTTY", {
        value,
        configurable: true,
        writable: true,
      });
    };
    const restoreStdinTty = (): void => {
      const desc = stdinTty();
      if (desc) Object.defineProperty(process.stdin, "isTTY", desc);
      else Reflect.deleteProperty(process.stdin, "isTTY");
    };

    beforeEach(() => {
      freshChats = SAMPLE_CHATS.map((c) => ({ ...c }));
      deleteExecute = mock(() => Promise.resolve());
      exportExecute = mock(() => Promise.resolve());
      fetchExecute = mock(() => Promise.resolve());
      mock.module("../../src/cli/command-registry.ts", () => ({
        CommandRegistry: class {
          registerAllCommands(): void {}
          getHandler(name: string): { execute: ReturnType<typeof mock> } | undefined {
            if (name === "delete") return { execute: deleteExecute };
            if (name === "export") return { execute: exportExecute };
            if (name === "fetch") return { execute: fetchExecute };
            return undefined;
          }
        },
      }));
    });

    afterEach(() => {
      deleteExecute.mockClear();
      exportExecute.mockClear();
      fetchExecute.mockClear();
      mock.restore();
    });

    test("action menu offers a Delete option", async () => {
      setStdinTty(true);
      try {
        const browserSpy = spyOn(promptsModule, "browser")
          .mockResolvedValueOnce({ kind: "pick", chat: SAMPLE_CHATS[0] } as any)
          .mockResolvedValue({ kind: "quit" } as any);
        const selectSpy = spyOn(promptsModule, "select").mockResolvedValue("delete" as any);
        const textSpy = spyOn(promptsModule, "text").mockResolvedValue("./dummy.md");

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        const callArg = selectSpy.mock.calls[0][0] as any;
        const values = (callArg.choices as Array<{ value: string; label: string }>).map(
          (c) => c.value,
        );
        expect(values).toContain("delete");
        const deleteChoice = (callArg.choices as Array<{ value: string; label: string; description?: string }>).find(
          (c) => c.value === "delete",
        );
        expect(deleteChoice?.label).toBe("Delete conversation");
        expect(browserSpy).toHaveBeenCalledTimes(2);
        expect(textSpy).not.toHaveBeenCalled();
      } finally {
        restoreStdinTty();
      }
    });

    test("selecting Delete dispatches to delete with --force and no confirmation", async () => {
      setStdinTty(true);
      try {
        spyOn(promptsModule, "browser")
          .mockResolvedValueOnce({ kind: "pick", chat: SAMPLE_CHATS[0] } as any)
          .mockResolvedValue({ kind: "quit" } as any);
        spyOn(promptsModule, "select").mockResolvedValue("delete" as any);
        const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(true);
        spyOn(promptsModule, "text").mockResolvedValue("./dummy.md");

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        expect(deleteExecute).toHaveBeenCalledTimes(1);
        const callArgs = deleteExecute.mock.calls[0][0] as string[];
        expect(callArgs[0]).toBe(SAMPLE_CHATS[0].id);
        expect(callArgs).toContain("--force");
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(exportExecute).not.toHaveBeenCalled();
        expect(fetchExecute).not.toHaveBeenCalled();
      } finally {
        restoreStdinTty();
      }
    });

    test("selecting Export to Markdown prompts for a path and forwards --out", async () => {
      setStdinTty(true);
      try {
        spyOn(promptsModule, "browser")
          .mockResolvedValueOnce({ kind: "pick", chat: SAMPLE_CHATS[0] } as any)
          .mockResolvedValue({ kind: "quit" } as any);
        spyOn(promptsModule, "select").mockResolvedValue("export-markdown" as any);
        const textSpy = spyOn(promptsModule, "text").mockResolvedValue("./my-export.md");

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        expect(textSpy).toHaveBeenCalledTimes(1);
        const textCallArg = textSpy.mock.calls[0][0] as { message: string; default?: string };
        expect(textCallArg.message).toBe("Output path:");
        expect(textCallArg.default).toMatch(
          new RegExp(`^gemini-chat-${SAMPLE_CHATS[0].id}-\\d{4}-\\d{2}-\\d{2}\\.md$`),
        );

        expect(exportExecute).toHaveBeenCalledTimes(1);
        const exportArgs = exportExecute.mock.calls[0][0] as string[];
        expect(exportArgs[0]).toBe(SAMPLE_CHATS[0].id);
        expect(exportArgs).toContain("--format");
        expect(exportArgs).toContain("markdown");
        expect(exportArgs).toContain("--out");
        expect(exportArgs).toContain("./my-export.md");
        expect(deleteExecute).not.toHaveBeenCalled();
      } finally {
        restoreStdinTty();
      }
    });

    test("selecting Export to JSON prompts for a path with .json default", async () => {
      setStdinTty(true);
      try {
        spyOn(promptsModule, "browser")
          .mockResolvedValueOnce({ kind: "pick", chat: SAMPLE_CHATS[0] } as any)
          .mockResolvedValue({ kind: "quit" } as any);
        spyOn(promptsModule, "select").mockResolvedValue("export-json" as any);
        const textSpy = spyOn(promptsModule, "text").mockResolvedValue("./my-export.json");

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        const textCallArg = textSpy.mock.calls[0][0] as { default?: string };
        expect(textCallArg.default).toMatch(
          new RegExp(`^gemini-chat-${SAMPLE_CHATS[0].id}-\\d{4}-\\d{2}-\\d{2}\\.json$`),
        );

        const exportArgs = exportExecute.mock.calls[0][0] as string[];
        expect(exportArgs).toContain("--format");
        expect(exportArgs).toContain("json");
        expect(exportArgs).toContain("--out");
        expect(exportArgs).toContain("./my-export.json");
      } finally {
        restoreStdinTty();
      }
    });

    test("empty export path falls back to the default filename", async () => {
      setStdinTty(true);
      try {
        spyOn(promptsModule, "browser")
          .mockResolvedValueOnce({ kind: "pick", chat: SAMPLE_CHATS[0] } as any)
          .mockResolvedValue({ kind: "quit" } as any);
        spyOn(promptsModule, "select").mockResolvedValue("export-markdown" as any);
        spyOn(promptsModule, "text").mockResolvedValue("   ");

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        const exportArgs = exportExecute.mock.calls[0][0] as string[];
        const outIdx = exportArgs.indexOf("--out");
        const outPath = exportArgs[outIdx + 1];
        expect(outPath).toMatch(
          new RegExp(`^gemini-chat-${SAMPLE_CHATS[0].id}-\\d{4}-\\d{2}-\\d{2}\\.md$`),
        );
      } finally {
        restoreStdinTty();
      }
    });

    test("after delete, the chat is removed from the list passed to the next browser call", async () => {
      setStdinTty(true);
      try {
        const deletedId = SAMPLE_CHATS[0].id;
        let firstCallChatsSnapshot: string[] = [];
        const browserSpy = spyOn(promptsModule, "browser")
          .mockImplementationOnce((config: any) => {
            firstCallChatsSnapshot = (config.chats as ChatInfo[]).map((c) => c.id);
            return Promise.resolve({ kind: "pick", chat: SAMPLE_CHATS[0] } as any);
          })
          .mockResolvedValue({ kind: "quit" } as any);
        spyOn(promptsModule, "select").mockResolvedValue("delete" as any);

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        expect(browserSpy).toHaveBeenCalledTimes(2);
        const secondChats = (browserSpy.mock.calls[1][0] as { chats: ChatInfo[] }).chats;
        expect(firstCallChatsSnapshot).toHaveLength(SAMPLE_CHATS.length);
        expect(firstCallChatsSnapshot).toContain(deletedId);
        expect(secondChats).toHaveLength(SAMPLE_CHATS.length - 1);
        expect(secondChats.map((c) => c.id)).not.toContain(deletedId);
        expect(secondChats.map((c) => c.id)).toEqual(
          SAMPLE_CHATS.filter((c) => c.id !== deletedId).map((c) => c.id),
        );
      } finally {
        restoreStdinTty();
      }
    });

    test("after a non-delete action, the chats list is unchanged on the next browser call", async () => {
      setStdinTty(true);
      try {
        const browserSpy = spyOn(promptsModule, "browser")
          .mockResolvedValueOnce({ kind: "pick", chat: SAMPLE_CHATS[0] } as any)
          .mockResolvedValue({ kind: "quit" } as any);
        spyOn(promptsModule, "select").mockResolvedValue("copy-id" as any);

        client.listChats = mock(async () => freshChats);

        await command.execute(["--interactive"], context);

        const secondChats = (browserSpy.mock.calls[1][0] as { chats: ChatInfo[] }).chats;
        expect(secondChats).toHaveLength(SAMPLE_CHATS.length);
        expect(secondChats.map((c) => c.id)).toEqual(
          [...SAMPLE_CHATS].sort((a, b) => b.timestamp - a.timestamp).map((c) => c.id),
        );
      } finally {
        restoreStdinTty();
      }
    });
  });
});
