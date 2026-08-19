import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ListCommand } from "../../../src/cli/commands/list-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import type { ChatInfo } from "../../../src/core/types.ts";
import { CancellationError } from "../../../src/cli/utils/prompts.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import { createMockChatList } from "../../fixtures/chat-fixtures.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import { setStdinTty, restoreStdinTty } from "../../cli/utils/tty-harness.ts";

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
  let cookieSession: {
    probe: ReturnType<typeof mock>;
    recover: ReturnType<typeof mock>;
    rotationInFlight: ReturnType<typeof mock>;
    waitForRotation: ReturnType<typeof mock>;
  };
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    command = new ListCommand();
    client = makeClient();
    cookieSession = {
      probe: mock(async () => "live" as const),
      recover: mock(async () => ({})),
      rotationInFlight: mock(() => false),
      waitForRotation: mock(async () => null),
    };
    context = {
      verbose: false,
      cookieSession: cookieSession as unknown as CliCommandContext["cookieSession"],
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
    test("single-profile errors are captured as outcomes; the empty result renders with the empty message", async () => {
      const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        client.listChats.mockRejectedValue(new Error("Network error"));

        await command.execute(["--profile", "work"], context);

        const stdout = logSpy.mock.calls.map((c) => c[0]).join("\n");
        const stderr = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stdout).toContain("No conversations found");
        expect(stderr).toContain("Network error");
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  describe("rotation-await stage", () => {
    test("in-flight rotation is awaited and the retried list renders without classifying", async () => {
      const recoveredChat: ChatInfo = {
        id: "conv-42",
        title: "Post-rotation chat",
        isPinned: false,
        timestamp: 1717100000000,
        profile: "work",
      };
      let listCalls = 0;
      client.listChats = mock(async () => {
        listCalls += 1;
        return listCalls === 1 ? [] : [recoveredChat];
      });
      cookieSession.rotationInFlight = mock(() => true);
      cookieSession.waitForRotation = mock(async () => ({ cookies: [] }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
        expect(cookieSession.waitForRotation).toHaveBeenCalledWith("work");
        expect(cookieSession.probe).not.toHaveBeenCalled();
        expect(client.listChats).toHaveBeenCalledTimes(2);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Post-rotation chat");
        expect(output).not.toContain("No conversations found");
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("rotation wait timeout prints the re-run hint and falls through to classification", async () => {
      client.listChats = mock(async () => []);
      cookieSession.rotationInFlight = mock(() => true);
      cookieSession.waitForRotation = mock(async () => null);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("still in progress");
        expect(stderr).toContain("re-run");
        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        expect(cookieSession.recover).not.toHaveBeenCalled();
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("refreshed session with a still-empty retry falls through to classification", async () => {
      client.listChats = mock(async () => []);
      let inFlight = true;
      cookieSession.rotationInFlight = mock(() => inFlight);
      cookieSession.waitForRotation = mock(async () => {
        inFlight = false;
        return { cookies: [] };
      });
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        expect(client.listChats).toHaveBeenCalledTimes(2);
        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).not.toContain("still in progress");
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("no rotation in flight skips the wait entirely", async () => {
      client.listChats = mock(async () => []);

      await command.execute(["--profile", "work"], context);

      expect(cookieSession.waitForRotation).not.toHaveBeenCalled();
      expect(cookieSession.probe).toHaveBeenCalledTimes(1);
    });

    test("multi-profile empty result awaits in-flight rotations and the retry renders", async () => {
      const profiles = ["work", "personal"];
      context.listProfiles = () => profiles;
      cookieSession.rotationInFlight = mock((p: string) => p === "work");
      cookieSession.waitForRotation = mock(async (p: string) =>
        p === "work" ? ({ cookies: [] }) : null,
      );
      const callsPerProfile: Record<string, number> = {};
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => {
          callsPerProfile[name] = (callsPerProfile[name] ?? 0) + 1;
          return name === "work" && callsPerProfile[name] > 1
            ? [{ id: "w1", title: "Rotated chat", isPinned: false, timestamp: Date.now(), profile: "work" }]
            : [];
        }),
      }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute([], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
        expect(cookieSession.waitForRotation).toHaveBeenCalledWith("work");
        expect(cookieSession.probe).not.toHaveBeenCalled();
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Rotated chat");
        expect(output).not.toContain("No conversations found");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("multi-profile rotation timeout prints the hint and never classifies", async () => {
      const profiles = ["work", "personal"];
      context.listProfiles = () => profiles;
      client.forProfile = mock((_name: string) => ({
        listChats: mock(async () => []),
      }));
      cookieSession.rotationInFlight = mock(() => true);
      cookieSession.waitForRotation = mock(async () => null);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute([], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(2);
        expect(cookieSession.probe).not.toHaveBeenCalled();
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("still in progress");
        expect(stderr).toContain("profiles");
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("multi-profile empty result with no rotation in flight skips the wait", async () => {
      client.forProfile = mock((_name: string) => ({
        listChats: mock(async () => []),
      }));
      context.listProfiles = () => ["a", "b"];

      await command.execute([], context);

      expect(cookieSession.waitForRotation).not.toHaveBeenCalled();
      expect(cookieSession.probe).not.toHaveBeenCalled();
    });

    test("live sibling masks no longer: stale profile with rotation in flight is awaited and re-queried", async () => {
      const profiles = ["live", "stale"];
      context.listProfiles = () => profiles;
      const callsPerProfile: Record<string, number> = {};
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => {
          callsPerProfile[name] = (callsPerProfile[name] ?? 0) + 1;
          if (name === "live") return [
            { id: "live-1", title: "Live chat", isPinned: false, timestamp: 1717100000000, profile: "live" },
          ];
          return callsPerProfile[name] > 1
            ? [{ id: "stale-1", title: "Recovered chat", isPinned: false, timestamp: 1717000000000, profile: "stale" }]
            : [];
        }),
      }));
      cookieSession.rotationInFlight = mock((p: string) => p === "stale");
      cookieSession.waitForRotation = mock(async (p: string) =>
        p === "stale" ? ({ cookies: [] }) : null,
      );
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute([], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
        expect(cookieSession.waitForRotation).toHaveBeenCalledWith("stale");
        expect(callsPerProfile["live"]).toBe(1);
        expect(callsPerProfile["stale"]).toBe(2);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Live chat");
        expect(output).toContain("Recovered chat");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("live sibling masks no longer: stale profile rejection still triggers wait+re-query", async () => {
      const profiles = ["live", "stale"];
      context.listProfiles = () => profiles;
      const callsPerProfile: Record<string, number> = {};
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => {
          callsPerProfile[name] = (callsPerProfile[name] ?? 0) + 1;
          if (name === "live") return [
            { id: "live-1", title: "Live chat", isPinned: false, timestamp: 1717100000000, profile: "live" },
          ];
          if (callsPerProfile[name] === 1) throw new Error("phantom jar");
          return [{ id: "stale-1", title: "Recovered chat", isPinned: false, timestamp: 1717000000000, profile: "stale" }];
        }),
      }));
      cookieSession.rotationInFlight = mock((p: string) => p === "stale");
      cookieSession.waitForRotation = mock(async () => ({ cookies: [] }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute([], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
        expect(cookieSession.waitForRotation).toHaveBeenCalledWith("stale");
        expect(callsPerProfile["stale"]).toBe(2);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Live chat");
        expect(output).toContain("Recovered chat");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("live profile with chats is never awaited or re-queried even while its rotation is in flight", async () => {
      const profiles = ["live", "fresh"];
      context.listProfiles = () => profiles;
      const callsPerProfile: Record<string, number> = {};
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => {
          callsPerProfile[name] = (callsPerProfile[name] ?? 0) + 1;
          return [{ id: `${name}-1`, title: `${name} chat`, isPinned: false, timestamp: 1717100000000, profile: name }];
        }),
      }));
      cookieSession.rotationInFlight = mock((p: string) => p === "live");
      cookieSession.waitForRotation = mock(async () => ({ cookies: [] }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--format", "json"], context);

        expect(cookieSession.waitForRotation).not.toHaveBeenCalled();
        expect(callsPerProfile["live"]).toBe(1);
        expect(callsPerProfile["fresh"]).toBe(1);
        const parsed = JSON.parse(logSpy.mock.calls.map((c) => c[0]).join("\n"));
        expect(parsed.chats).toHaveLength(2);
        expect(parsed.chats.filter((c: ChatInfo) => c.id === "live-1")).toHaveLength(1);
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).not.toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("live returns 14 chats while stale's in-flight rotation lands: stale re-queried, both merged, live untouched", async () => {
      const profiles = ["live", "stale"];
      context.listProfiles = () => profiles;
      const liveChats: ChatInfo[] = Array.from({ length: 14 }, (_, i) => ({
        id: `live-${i + 1}`,
        title: `Live chat ${i + 1}`,
        isPinned: false,
        timestamp: 1717100000000 - i,
        profile: "live",
      }));
      const callsPerProfile: Record<string, number> = {};
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => {
          callsPerProfile[name] = (callsPerProfile[name] ?? 0) + 1;
          if (name === "live") return liveChats;
          return callsPerProfile[name] > 1
            ? [{ id: "stale-1", title: "Recovered chat", isPinned: false, timestamp: 1717000000000, profile: "stale" }]
            : [];
        }),
      }));
      cookieSession.rotationInFlight = mock((p: string) => p === "stale");
      cookieSession.waitForRotation = mock(async (p: string) =>
        p === "stale" ? ({ cookies: [] }) : null,
      );
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--format", "json"], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
        expect(cookieSession.waitForRotation).toHaveBeenCalledWith("stale");
        expect(callsPerProfile["live"]).toBe(1);
        expect(callsPerProfile["stale"]).toBe(2);
        const parsed = JSON.parse(logSpy.mock.calls.map((c) => c[0]).join("\n"));
        expect(parsed.chats).toHaveLength(15);
        expect(parsed.chats.filter((c: ChatInfo) => c.profile === "live")).toHaveLength(14);
        expect(parsed.chats.filter((c: ChatInfo) => c.id === "stale-1")).toHaveLength(1);
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("all-fresh fan-out is byte-identical: no wait, no re-query", async () => {
      const profiles = ["live1", "live2"];
      context.listProfiles = () => profiles;
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => [
          { id: `${name}-1`, title: `${name} chat`, isPinned: false, timestamp: 1717100000000, profile: name },
        ]),
      }));
      cookieSession.rotationInFlight = mock(() => false);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute([], context);

        expect(cookieSession.waitForRotation).not.toHaveBeenCalled();
        for (const name of profiles) {
          expect(client.forProfile).toHaveBeenCalledWith(name);
        }
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).not.toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });

    test("all-stale fan-out still works: every in-flight profile gets awaited and re-queried", async () => {
      const profiles = ["a", "b"];
      context.listProfiles = () => profiles;
      const callsPerProfile: Record<string, number> = {};
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => {
          callsPerProfile[name] = (callsPerProfile[name] ?? 0) + 1;
          return callsPerProfile[name] > 1
            ? [{ id: `${name}-1`, title: `${name} recovered`, isPinned: false, timestamp: 1717100000000, profile: name }]
            : [];
        }),
      }));
      cookieSession.rotationInFlight = mock(() => true);
      cookieSession.waitForRotation = mock(async () => ({ cookies: [] }));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute([], context);

        expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(2);
        for (const name of profiles) {
          expect(callsPerProfile[name]).toBe(2);
        }
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("a recovered");
        expect(output).toContain("b recovered");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("waiting");
      } finally {
        errSpy.mockRestore();
      }
    });
  });

  describe("reactive phantom detection", () => {
    let promptsModule: typeof import("../../../src/cli/utils/prompts.ts");

    beforeEach(async () => {
      promptsModule = await import("../../../src/cli/utils/prompts.ts");
    });

    test("phantom result (TTY) triggers one probe, one recovery, one retry, renders retried chats", async () => {
      setStdinTty(true);
      const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(true);
      const recoveredChat: ChatInfo = {
        id: "conv-9",
        title: "Recovered chat",
        isPinned: false,
        timestamp: 1717100000000,
        profile: "work",
      };
      let listCalls = 0;
      client.listChats = mock(async () => {
        listCalls += 1;
        return listCalls === 1 ? [] : [recoveredChat];
      });
      cookieSession.probe = mock(async () => "phantom" as const);
      cookieSession.recover = mock(async () => ({}));
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        expect(cookieSession.probe).toHaveBeenCalledWith("work");
        expect(cookieSession.recover).toHaveBeenCalledTimes(1);
        expect(cookieSession.recover).toHaveBeenCalledWith("work");
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(client.listChats).toHaveBeenCalledTimes(2);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("Recovered chat");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).not.toContain("phantom");
      } finally {
        errSpy.mockRestore();
        restoreStdinTty();
      }
    });

    test("live empty result probes once and never recovers", async () => {
      setStdinTty(false);
      const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(true);
      cookieSession.probe = mock(async () => "live" as const);
      client.listChats = mock(async () => []);

      try {
        await command.execute(["--profile", "work"], context);

        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        expect(cookieSession.probe).toHaveBeenCalledWith("work");
        expect(cookieSession.recover).not.toHaveBeenCalled();
        expect(confirmSpy).not.toHaveBeenCalled();
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        restoreStdinTty();
      }
    });

    test("multi-profile query never classifies", async () => {
      const profileChats: Record<string, ChatInfo[]> = {
        work: [],
        personal: [{ id: "conv-2", title: "Chat 2", isPinned: false, timestamp: Date.now(), profile: "personal" }],
      };
      context.listProfiles = () => Object.keys(profileChats);
      client.forProfile = mock((name: string) => ({
        listChats: mock(async () => profileChats[name] ?? []),
      }));

      await command.execute(["--all-profiles"], context);
      expect(cookieSession.probe).not.toHaveBeenCalled();

      client.forProfile = mock((_name: string) => ({
        listChats: mock(async () => []),
      }));
      await command.execute([], context);
      expect(cookieSession.probe).not.toHaveBeenCalled();
    });

    test("non-interactive phantom keeps stdout byte-identical and diagnoses on stderr", async () => {
      setStdinTty(false);
      client.listChats = mock(async () => []);
      cookieSession.probe = mock(async () => "phantom" as const);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);
        const stdoutPhantom = logSpy.mock.calls.map((c) => c[0]).join("\n");
        const stderrPhantom = errSpy.mock.calls.map((c) => c[0]).join("\n");

        logSpy.mockClear();
        cookieSession.probe = mock(async () => "live" as const);
        cookieSession.recover.mockClear();

        await command.execute(["--profile", "work"], context);
        const stdoutLive = logSpy.mock.calls.map((c) => c[0]).join("\n");

        expect(stdoutPhantom).toBe(stdoutLive);
        expect(stderrPhantom).toContain("work");
        expect(stderrPhantom).toContain("phantom");
        expect(stderrPhantom).toContain("gemiterm auth");
        expect(cookieSession.recover).not.toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
        restoreStdinTty();
      }
    });

    test("non-interactive dead classification names the state", async () => {
      setStdinTty(false);
      cookieSession.probe = mock(async () => "dead" as const);
      client.listChats = mock(async () => []);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("dead");
        expect(stderr).toContain("gemiterm auth");
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        errSpy.mockRestore();
        restoreStdinTty();
      }
    });

    test("TTY decline leaves the empty output and skips recovery", async () => {
      setStdinTty(true);
      const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(false);
      cookieSession.probe = mock(async () => "phantom" as const);
      client.listChats = mock(async () => []);

      try {
        await command.execute(["--profile", "work"], context);

        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(cookieSession.recover).not.toHaveBeenCalled();
        expect(client.listChats).toHaveBeenCalledTimes(1);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        restoreStdinTty();
      }
    });

    test("TTY CancellationError is treated as decline", async () => {
      setStdinTty(true);
      const confirmSpy = spyOn(promptsModule, "confirm").mockRejectedValue(
        new CancellationError("cancel"),
      );
      cookieSession.probe = mock(async () => "phantom" as const);
      client.listChats = mock(async () => []);

      try {
        await command.execute(["--profile", "work"], context);

        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(cookieSession.recover).not.toHaveBeenCalled();
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        restoreStdinTty();
      }
    });

    test("recovery failure surfaces AuthenticationError", async () => {
      setStdinTty(true);
      spyOn(promptsModule, "confirm").mockResolvedValue(true);
      cookieSession.probe = mock(async () => "phantom" as const);
      cookieSession.recover = mock(async () => {
        throw new AuthenticationError(
          "Session refresh failed for profile 'work'. Run 'gemiterm auth' to re-authenticate.",
        );
      });
      client.listChats = mock(async () => []);

      try {
        await expect(
          command.execute(["--profile", "work"], context),
        ).rejects.toThrow("Session refresh failed for profile 'work'");
        expect(client.listChats).toHaveBeenCalledTimes(1);
      } finally {
        restoreStdinTty();
      }
    });

    test("still-empty retry prints the honest diagnostic", async () => {
      setStdinTty(true);
      spyOn(promptsModule, "confirm").mockResolvedValue(true);
      cookieSession.probe = mock(async () => "phantom" as const);
      cookieSession.recover = mock(async () => ({}));
      client.listChats = mock(async () => []);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        expect(client.listChats).toHaveBeenCalledTimes(2);
        const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(stderr).toContain("still reports no conversations");
        expect(stderr).toContain("gemiterm auth");
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
      } finally {
        errSpy.mockRestore();
        restoreStdinTty();
      }
    });

    test("probe failure degrades to the normal empty output", async () => {
      setStdinTty(false);
      cookieSession.probe = mock(async () => {
        throw new Error("classifier blew up");
      });
      client.listChats = mock(async () => []);
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      try {
        await command.execute(["--profile", "work"], context);

        expect(cookieSession.probe).toHaveBeenCalledTimes(1);
        const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
        expect(output).toContain("No conversations found");
        expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).not.toContain("phantom");
      } finally {
        errSpy.mockRestore();
        restoreStdinTty();
      }
    });
  });
});
