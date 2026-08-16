import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { NewCommand } from "../../src/cli/commands/new-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import type { ChatInfo, Message } from "../../src/core/types.ts";

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
    context = {
      verbose: false,
      cookieSession: {} as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
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
