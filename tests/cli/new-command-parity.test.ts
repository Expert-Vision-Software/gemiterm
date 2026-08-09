import { describe, test, expect, mock, spyOn } from "bun:test";
import { Mediator } from "../../src/core/mediator.ts";
import { COMMAND_TYPES, type Command } from "../../src/core/command-handlers.ts";
import type { SendMessageCommandPayload, SendMessageCommandResult } from "../../src/core/command-handlers.ts";
import type { StartNewChatCommandPayload, StartNewChatCommandResult } from "../../src/core/command-handlers.ts";

describe("NewCommand interactive REPL subsequent-turn dispatch", () => {
  test("first REPL turn dispatches START_NEW_CHAT", async () => {
    const handlerSpy = mock(
      async (cmd: Command<StartNewChatCommandPayload>): Promise<StartNewChatCommandResult> => {
        return { response: "mock response", conversationId: "conv-new-1" };
      },
    );

    const mediator = new Mediator();
    mediator.registerCommandHandler({
      commandType: COMMAND_TYPES.START_NEW_CHAT,
      handle: handlerSpy,
    });
    mediator.registerCommandHandler({
      commandType: COMMAND_TYPES.SEND_MESSAGE,
      handle: mock(async () => ({ response: "mock" })),
    });

    const message = "Hi";
    const profileName: string | null = null;
    let conversationId: string | null = null;

    const messageHandler = async (msg: string) => {
      const isFirst = !conversationId;
      if (isFirst) {
        const payload: StartNewChatCommandPayload = { message: msg };
        if (profileName) payload.profileName = profileName;
        const result = await mediator.send<StartNewChatCommandResult>({
          type: COMMAND_TYPES.START_NEW_CHAT,
          payload,
        } as Command<StartNewChatCommandPayload>);
        conversationId = result.conversationId;
        return { response: result.response };
      }
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId: conversationId!, message: msg, profileName: profileName ?? undefined },
      } as Command<SendMessageCommandPayload>);
      return { response: result.response };
    };

    await messageHandler(message);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const payload = handlerSpy.mock.calls[0][0].payload;
    expect(payload.message).toBe("Hi");
  });

  test("second REPL turn dispatches SEND_MESSAGE against captured conversationId", async () => {
    const startSpy = mock(
      async (cmd: Command<StartNewChatCommandPayload>): Promise<StartNewChatCommandResult> => {
        return { response: "first response", conversationId: "conv-new-2" };
      },
    );
    const sendSpy = mock(
      async (cmd: Command<SendMessageCommandPayload>): Promise<SendMessageCommandResult> => {
        return { response: "second response" };
      },
    );

    const mediator = new Mediator();
    mediator.registerCommandHandler({ commandType: COMMAND_TYPES.START_NEW_CHAT, handle: startSpy });
    mediator.registerCommandHandler({ commandType: COMMAND_TYPES.SEND_MESSAGE, handle: sendSpy });

    const profileName: string | null = null;
    let conversationId: string | null = null;

    const messageHandler = async (msg: string) => {
      const isFirst = !conversationId;
      if (isFirst) {
        const payload: StartNewChatCommandPayload = { message: msg };
        if (profileName) payload.profileName = profileName;
        const result = await mediator.send<StartNewChatCommandResult>({
          type: COMMAND_TYPES.START_NEW_CHAT,
          payload,
        } as Command<StartNewChatCommandPayload>);
        conversationId = result.conversationId;
        return { response: result.response };
      }
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId: conversationId!, message: msg, profileName: profileName ?? undefined },
      } as Command<SendMessageCommandPayload>);
      return { response: result.response };
    };

    await messageHandler("first msg");
    await messageHandler("follow up");

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sendPayload = sendSpy.mock.calls[0][0].payload;
    expect(sendPayload.conversationId).toBe("conv-new-2");
    expect(sendPayload.message).toBe("follow up");
  });

  test("third turn also dispatches SEND_MESSAGE, not START_NEW_CHAT", async () => {
    const startSpy = mock(
      async (cmd: Command<StartNewChatCommandPayload>): Promise<StartNewChatCommandResult> => {
        return { response: "ok", conversationId: "conv-new-3" };
      },
    );
    const sendSpy = mock(
      async (cmd: Command<SendMessageCommandPayload>): Promise<SendMessageCommandResult> => {
        return { response: "ok" };
      },
    );

    const mediator = new Mediator();
    mediator.registerCommandHandler({ commandType: COMMAND_TYPES.START_NEW_CHAT, handle: startSpy });
    mediator.registerCommandHandler({ commandType: COMMAND_TYPES.SEND_MESSAGE, handle: sendSpy });

    const profileName: string | null = null;
    let conversationId: string | null = null;

    const messageHandler = async (msg: string) => {
      const isFirst = !conversationId;
      if (isFirst) {
        const payload: StartNewChatCommandPayload = { message: msg };
        if (profileName) payload.profileName = profileName;
        const result = await mediator.send<StartNewChatCommandResult>({
          type: COMMAND_TYPES.START_NEW_CHAT,
          payload,
        } as Command<StartNewChatCommandPayload>);
        conversationId = result.conversationId;
        return { response: result.response };
      }
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId: conversationId!, message: msg, profileName: profileName ?? undefined },
      } as Command<SendMessageCommandPayload>);
      return { response: result.response };
    };

    await messageHandler("turn 1");
    await messageHandler("turn 2");
    await messageHandler("turn 3");

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[0][0].payload.message).toBe("turn 2");
    expect(sendSpy.mock.calls[1][0].payload.message).toBe("turn 3");
  });

  test("subsequent turn SEND_MESSAGE payload matches continue non-interactive path", async () => {
    const spyClient = {
      sendMessage: mock(async (convId: string, msg: string) => `response to: ${msg}`),
      deleteChat: mock(async () => {}),
      startNewChat: mock(async () => ({ response: "ok", conversationId: "conv-parity" })),
      profileHasConversation: mock(async () => false),
      forProfile: mock(async () => spyClient),
      listChats: mock(async () => []),
      models: mock(async () => []),
    };

    const mediator = new Mediator();
    mediator.registerCommandHandler({
      commandType: COMMAND_TYPES.SEND_MESSAGE,
      handle: mock(async (cmd: Command<SendMessageCommandPayload>) => {
        spyClient.sendMessage(cmd.payload.conversationId, cmd.payload.message);
        return { response: "ok" };
      }),
    });
    mediator.registerCommandHandler({
      commandType: COMMAND_TYPES.START_NEW_CHAT,
      handle: mock(async (cmd: Command<StartNewChatCommandPayload>) => {
        return { response: "ok", conversationId: "conv-parity" };
      }),
    });

    const profileName: string | null = "work";
    let conversationId: string | null = null;

    const messageHandler = async (msg: string) => {
      const isFirst = !conversationId;
      if (isFirst) {
        const result = await mediator.send<StartNewChatCommandResult>({
          type: COMMAND_TYPES.START_NEW_CHAT,
          payload: { message: msg, profileName },
        } as Command<StartNewChatCommandPayload>);
        conversationId = result.conversationId;
        return { response: result.response };
      }
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId: conversationId!, message: msg, profileName },
      } as Command<SendMessageCommandPayload>);
      return { response: result.response };
    };

    await messageHandler("first");

    spyClient.sendMessage.mockClear();
    await messageHandler("follow up");

    const interactiveCall = spyClient.sendMessage.mock.calls[0] as [string, string];
    expect(interactiveCall[0]).toBe("conv-parity");
    expect(interactiveCall[1]).toBe("follow up");
  });
});
