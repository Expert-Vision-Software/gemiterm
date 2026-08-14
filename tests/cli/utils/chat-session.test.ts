import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { startChatSession } from "../../../src/cli/utils/chat-session.ts";
import { Logger } from "../../../src/infrastructure/logger.ts";
import type { MessageHandler } from "../../../src/cli/utils/interactive-prompt.ts";

function makeClient() {
  const client: any = {
    startNewChat: mock(async (_msg: string) => ({ response: "hi", conversationId: "conv-1" })),
    sendMessage: mock(async (_id: string, _msg: string) => "reply"),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("startChatSession", () => {
  let interactivePrompt: typeof import("../../../src/cli/utils/interactive-prompt.ts");
  let client: ReturnType<typeof makeClient>;
  let logger: Logger;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    interactivePrompt = await import("../../../src/cli/utils/interactive-prompt.ts");
    client = makeClient();
    logger = new Logger("chat-session");
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
  });

  test("non-null message starts a new chat and prints the model response", async () => {
    const onFirstTurn = mock((_id: string) => {});
    await startChatSession({
      effectiveMessage: "hello",
      getGeminiClient: () => client,
      logger,
      onFirstTurn,
    });

    expect(client.startNewChat).toHaveBeenCalledWith("hello");
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(onFirstTurn).toHaveBeenCalledWith("conv-1");

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Model:");
    expect(output).toContain("hi");
  });

  test("conversationId appends via sendMessage (no new chat, no first-turn hook)", async () => {
    const onFirstTurn = mock((_id: string) => {});
    await startChatSession({
      effectiveMessage: "follow up",
      conversationId: "conv-1",
      getGeminiClient: () => client,
      logger,
      onFirstTurn,
    });

    expect(client.sendMessage).toHaveBeenCalledWith("conv-1", "follow up");
    expect(client.startNewChat).not.toHaveBeenCalled();
    expect(onFirstTurn).not.toHaveBeenCalled();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Model:");
    expect(output).toContain("reply");
  });

  test("null message enters the REPL and starts a new chat on the first turn", async () => {
    let handler: MessageHandler | undefined;
    const onInteractiveTurn = mock((_id: string, _isFirst: boolean) => {});
    spyOn(interactivePrompt, "runInteractiveLoop").mockImplementation(async (h) => {
      handler = h;
    });

    await startChatSession({
      effectiveMessage: null,
      getGeminiClient: () => client,
      logger,
      onInteractiveTurn,
    });

    expect(handler).toBeDefined();

    await handler!("first");
    expect(client.startNewChat).toHaveBeenCalledWith("first");
    expect(onInteractiveTurn).toHaveBeenCalledWith("conv-1", true);

    await handler!("second");
    expect(client.sendMessage).toHaveBeenCalledWith("conv-1", "second");
    expect(onInteractiveTurn).toHaveBeenCalledWith("conv-1", false);
  });

  test("null message with conversationId appends each turn via sendMessage", async () => {
    let handler: MessageHandler | undefined;
    spyOn(interactivePrompt, "runInteractiveLoop").mockImplementation(async (h) => {
      handler = h;
    });

    await startChatSession({
      effectiveMessage: null,
      conversationId: "conv-1",
      getGeminiClient: () => client,
      logger,
    });

    await handler!("hello");
    expect(client.sendMessage).toHaveBeenCalledWith("conv-1", "hello");
    expect(client.startNewChat).not.toHaveBeenCalled();
  });

  test("beforeInteractiveLoop runs before the REPL starts", async () => {
    let handler: MessageHandler | undefined;
    const order: string[] = [];
    spyOn(interactivePrompt, "runInteractiveLoop").mockImplementation(async (h) => {
      order.push("loop");
      handler = h;
    });

    await startChatSession({
      effectiveMessage: null,
      getGeminiClient: () => client,
      logger,
      beforeInteractiveLoop: async () => {
        order.push("before");
      },
    });

    expect(order).toEqual(["before", "loop"]);
    expect(handler).toBeDefined();
  });

  test("profileName routes to forProfile", async () => {
    await startChatSession({
      effectiveMessage: "hi",
      profileName: "work",
      getGeminiClient: () => client,
      logger,
    });

    expect(client.forProfile).toHaveBeenCalledWith("work");
  });
});
