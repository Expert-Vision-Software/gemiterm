import { describe, test, expect, mock, spyOn } from "bun:test";
import { Mediator } from "../../src/core/mediator.ts";
import { COMMAND_TYPES, type Command } from "../../src/core/command-handlers.ts";
import type { SendMessageCommandPayload, SendMessageCommandResult } from "../../src/core/command-handlers.ts";

describe("ContinueCommand interactive-vs-non-interactive parity", () => {
  test("interactive messageHandler produces same SEND_MESSAGE payload as non-interactive path", async () => {
    const handlerSpy = mock(
      async (cmd: Command<SendMessageCommandPayload>): Promise<SendMessageCommandResult> => {
        return { response: "mock response" };
      },
    );

    const mediator = new Mediator();
    mediator.registerCommandHandler({
      commandType: COMMAND_TYPES.SEND_MESSAGE,
      handle: handlerSpy,
    });

    const conversationId = "conv-parity";
    const message = "hello";
    const profileName: string | null = null;

    const messageHandler = async (msg: string) => {
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId, message: msg, profileName: profileName ?? undefined },
      } as Command<SendMessageCommandPayload>);
      return { response: result.response };
    };

    await messageHandler(message);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const interactivePayload = handlerSpy.mock.calls[0][0].payload;

    handlerSpy.mockClear();

    await mediator.send<SendMessageCommandResult>({
      type: COMMAND_TYPES.SEND_MESSAGE,
      payload: { conversationId, message, profileName: profileName ?? undefined },
    } as Command<SendMessageCommandPayload>);

    const nonInteractivePayload = handlerSpy.mock.calls[0]?.[0]?.payload;

    expect(interactivePayload).toBeDefined();
    expect(nonInteractivePayload).toBeDefined();
    expect(JSON.stringify(interactivePayload)).toBe(JSON.stringify(nonInteractivePayload));
  });

  test("interactive messageHandler forwards profileName to payload", async () => {
    const handlerSpy = mock(
      async (cmd: Command<SendMessageCommandPayload>): Promise<SendMessageCommandResult> => {
        return { response: "mock response" };
      },
    );

    const mediator = new Mediator();
    mediator.registerCommandHandler({
      commandType: COMMAND_TYPES.SEND_MESSAGE,
      handle: handlerSpy,
    });

    const conversationId = "conv-profile";
    const message = "hello";
    const profileName = "work";

    const messageHandler = async (msg: string) => {
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId, message: msg, profileName: profileName ?? undefined },
      } as Command<SendMessageCommandPayload>);
      return { response: result.response };
    };

    await messageHandler(message);

    const payload = handlerSpy.mock.calls[0][0].payload;
    expect(payload.conversationId).toBe("conv-profile");
    expect(payload.message).toBe("hello");
    expect(payload.profileName).toBe("work");
  });
});
