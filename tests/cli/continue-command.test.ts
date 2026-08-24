import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import { ContinueCommand } from "../../src/cli/commands/continue-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import type { ChatInfo, Message } from "../../src/core/types.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-continue-cmd");

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

describe("ContinueCommand", () => {
  let command: ContinueCommand;
  let client: any;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ContinueCommand();
    client = makeClient();
    process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    context = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureSession: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
        rotationInFlight: mock(() => false),
        waitForRotation: mock(async () => null),
        probe: mock(async () => "live" as const),
        createKeepalive: mock(() => ({ start: mock(() => {}), stop: mock(() => {}) })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => ["default"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    delete process.env.GEMITERM_CONFIG_DIR;
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("continue");
    expect(command.description).toBe("Continue a conversation");
  });

  test("shows help with --help flag", async () => {
    await command.execute(["--help"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm continue");
    expect(output).toContain("conversation_id");
    expect(output).toContain("/exit");
  });

  test("shows help with -h flag", async () => {
    await command.execute(["-h"], context);
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Usage: gemiterm continue");
  });

  test("sends message in non-interactive mode with conversation_id and message", async () => {
    client.sendMessage = mock(async () => "Hello from Gemini!");

    await command.execute(["conv123", "Hello there"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Model:");
    expect(output).toContain("Hello from Gemini!");
    expect(client.sendMessage).toHaveBeenCalledWith("conv123", "Hello there", "gemini-3-flash");
  });

  test("sends correct command type via mediator", async () => {
    client.sendMessage = mock(async () => "ok");

    await command.execute(["conv-id", "test message"], context);

    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("invokes list command when no conversation_id provided", async () => {
    client.listChats = mock(async () => []);

    await command.execute([], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Listing conversations");
  });

  test("printLastMessage outputs last model message content", async () => {
    client.fetchChat = mock(async () => [
      { role: "user" as const, content: "Hello" },
      { role: "model" as const, content: "Hi there! How can I help?" },
    ]);

    await command.printLastMessage(() => client, "conv123", null);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Last response:");
    expect(output).toContain("Hi there! How can I help?");
    expect(client.fetchChat).toHaveBeenCalledWith("conv123");
  });

  test("--profile forwards the resolved profile into SEND_MESSAGE payload", async () => {
    (context.cookieSession as any).activeProfiles.mockReturnValue(["default"]);

    client.sendMessage = mock(async () => "ok");

    await command.execute(["conv123", "hi", "--profile", "default"], context);

    expect(client.forProfile).toHaveBeenCalledWith("default");
    expect(client.sendMessage).toHaveBeenCalledWith("conv123", "hi", "gemini-3-flash");
  });

  test("interactive mode forwards resolved profileName into FETCH_CHAT (printLastMessage)", async () => {
    (context.cookieSession as any).activeProfiles.mockReturnValue(["evs-diegohb"]);

    client.fetchChat = mock(async () => [
      { role: "user" as const, content: "old q" },
      { role: "model" as const, content: "old a" },
    ]);

    await command.printLastMessage(() => client, "conv-evs", "evs-diegohb");

    expect(client.forProfile).toHaveBeenCalledWith("evs-diegohb");
    expect(client.fetchChat).toHaveBeenCalledWith("conv-evs");
  });
});

describe("ContinueCommand keepalive wiring (fix-3b)", () => {
  let command: ContinueCommand;
  let client: any;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let startChatSessionSpy: ReturnType<typeof spyOn>;
  let chatSessionModule: typeof import("../../src/cli/utils/chat-session.ts");

  beforeEach(async () => {
    command = new ContinueCommand();
    client = makeClient();
    process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    context = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureSession: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
        rotationInFlight: mock(() => false),
        waitForRotation: mock(async () => null),
        probe: mock(async () => "live" as const),
        createKeepalive: mock(() => ({ start: mock(() => {}), stop: mock(() => {}) })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => ["default"],
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

  test("REPL entry with null profile resolution starts exactly one keepalive for the default profile", async () => {
    await command.execute(["conv123"], context);

    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledTimes(1);
    expect((context.cookieSession as any).createKeepalive).toHaveBeenCalledWith("default");
  });

  test("one-shot mode (message provided) constructs no keepalive", async () => {
    client.sendMessage = mock(async () => "ok");

    await command.execute(["conv123", "hello"], context);

    expect((context.cookieSession as any).createKeepalive).not.toHaveBeenCalled();
  });
});
