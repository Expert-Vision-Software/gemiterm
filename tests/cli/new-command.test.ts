import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { NewCommand } from "../../src/cli/commands/new-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { getDefaultProfileMarkerPath } from "../../src/infrastructure/path-utils.ts";
import type { ChatInfo, Message } from "../../src/core/types.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-new-cmd");

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

describe("NewCommand", () => {
  let command: NewCommand;
  let client: any;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new NewCommand();
    client = makeClient();
    process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    rmSync(join(TEST_DIR, "profiles"), { recursive: true, force: true });
    context = {
      verbose: false,
      cookieSession: {
        createKeepalive: mock(() => ({ start: mock(() => {}), stop: mock(() => {}) })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    delete process.env.GEMITERM_CONFIG_DIR;
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("new");
    expect(command.description).toBe("Start a new conversation");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm new");
    expect(output).toContain("--profile");
    expect(output).toContain("message");
  });

  test("shows help with -h flag", async () => {
    await command.execute(["-h"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm new");
  });

  test("sends start-new-chat command with message", async () => {
    client.startNewChat = mock(async () => ({
      response: "Hello from Gemini!",
      conversationId: "conv-123",
    }));

    await command.execute(["Hello there"], context);

    expect(client.startNewChat).toHaveBeenCalledWith("Hello there");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("conv-123");
    expect(output).toContain("Hello from Gemini!");
  });

  test("sends start-new-chat command with profile specified via -p", async () => {
    client.startNewChat = mock(async () => ({
      response: "Hello from Gemini!",
      conversationId: "conv-456",
    }));

    await command.execute(["-p", "dhb-worker", "a new test message"], context);

    expect(client.forProfile).toHaveBeenCalledWith("dhb-worker");
    expect(client.startNewChat).toHaveBeenCalledWith("a new test message");
  });

  test("sends start-new-chat command with profile specified via --profile", async () => {
    client.startNewChat = mock(async () => ({
      response: "Hello from Gemini!",
      conversationId: "conv-789",
    }));

    await command.execute(["--profile", "my-profile", "test message"], context);

    expect(client.forProfile).toHaveBeenCalledWith("my-profile");
    expect(client.startNewChat).toHaveBeenCalledWith("test message");
  });

  test("does not include profileName in payload when no profile specified", async () => {
    client.startNewChat = mock(async () => ({
      response: "Hello",
      conversationId: "conv-abc",
    }));

    await command.execute(["hello"], context);

    expect(client.forProfile).not.toHaveBeenCalled();
    expect(client.startNewChat).toHaveBeenCalledWith("hello");
  });
});

describe("NewCommand keepalive wiring (fix-3b)", () => {
  let command: NewCommand;
  let client: any;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let startChatSessionSpy: ReturnType<typeof spyOn>;
  let chatSessionModule: typeof import("../../src/cli/utils/chat-session.ts");

  beforeEach(async () => {
    command = new NewCommand();
    client = makeClient();
    process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    rmSync(join(TEST_DIR, "profiles"), { recursive: true, force: true });
    context = {
      verbose: false,
      cookieSession: {
        createKeepalive: mock(() => ({ start: mock(() => {}), stop: mock(() => {}) })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    chatSessionModule = await import("../../src/cli/utils/chat-session.ts");
    startChatSessionSpy = spyOn(chatSessionModule, "startChatSession").mockImplementation(async () => {});
  });

  afterEach(() => {
    startChatSessionSpy.mockRestore();
    mock.restore();
    logSpy.mockRestore();
    delete process.env.GEMITERM_CONFIG_DIR;
  });

  test("REPL entry uses the configured default profile name, never the literal 'default'", async () => {
    mkdirSync(join(TEST_DIR, "profiles"), { recursive: true });
    writeFileSync(getDefaultProfileMarkerPath(), "custom-default", "utf-8");

    await command.execute([], context);

    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledTimes(1);
    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledWith("custom-default");
  });

  test("REPL entry with an explicit profile starts the keepalive for that profile", async () => {
    await command.execute(["-p", "work"], context);

    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledTimes(1);
    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledWith("work");
  });

  test("REPL entry with no marker falls back to the 'default' profile name", async () => {
    await command.execute([], context);

    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledTimes(1);
    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledWith("default");
  });

  test("one-shot mode (message provided) constructs no keepalive", async () => {
    client.startNewChat = mock(async () => ({
      response: "Hello",
      conversationId: "conv-abc",
    }));

    await command.execute(["hello"], context);

    expect((context.cookieSession as any).createKeepalive).not.toHaveBeenCalled();
  });
});
