import { mock, expect } from "bun:test";
import { Mediator } from "../../../src/core/mediator.ts";
import {
  SendMessageCommandHandler,
  StartNewChatCommandHandler,
  type IGeminiClientService,
} from "../../../src/core/command-handlers.ts";

export interface SpyClientService extends IGeminiClientService {
  _sendMessageSpy: ReturnType<typeof mock>;
  _startNewChatSpy: ReturnType<typeof mock>;
}

export function createSpyClient(): SpyClientService {
  const sendSpy = mock(async (_convId: string, _msg: string) => "mock response");
  const startSpy = mock(async (_msg: string) => ({ response: "mock response", conversationId: "mock-cid" }));
  const self = mock(async () => self) as unknown as SpyClientService;

  (self as any).sendMessage = sendSpy;
  (self as any).startNewChat = startSpy;
  (self as any).forProfile = mock(async () => self);
  (self as any).deleteChat = mock(async () => {});
  (self as any).profileHasConversation = mock(async () => false);
  (self as any).listChats = mock(async () => []);
  (self as any).models = mock(async () => []);
  (self as any)._sendMessageSpy = sendSpy;
  (self as any)._startNewChatSpy = startSpy;

  return self;
}

export function createMediatorWithHandlers(
  spyClient: SpyClientService,
  handlers?: { startNewChat?: boolean },
): Mediator {
  const mediator = new Mediator();
  mediator.registerCommandHandler(new SendMessageCommandHandler(spyClient));
  if (handlers?.startNewChat) {
    mediator.registerCommandHandler(new StartNewChatCommandHandler(spyClient));
  }
  return mediator;
}

export function createMockContext(mediator: Mediator) {
  return {
    verbose: false as const,
    mediator,
    profileAuthManager: {
      getActiveProfiles: mock(() => []),
      findProfileForConversation: mock(() => null),
      ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
    },
  };
}

export function mockInteractiveLoop(replResponses: string[]): void {
  mock.module("../../src/cli/utils/interactive-prompt.ts", () => ({
    runInteractiveLoop: async (handler: (msg: string) => Promise<unknown>) => {
      for (const msg of replResponses) {
        await handler(msg);
      }
    },
    CancellationError: class extends Error {
      name = "CancellationError";
    },
  }));
}
