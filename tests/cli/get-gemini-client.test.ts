import { describe, test, expect, mock } from "bun:test";
import { Logger } from "../../src/infrastructure/logger.ts";
import {
  ListChatsQueryHandler,
  QUERY_TYPES,
} from "../../src/core/query-handlers.ts";
import {
  DeleteConversationCommandHandler,
  SendMessageCommandHandler,
  StartNewChatCommandHandler,
  COMMAND_TYPES,
} from "../../src/core/command-handlers.ts";
import type { IGeminiClientService } from "../../src/core/command-handlers.ts";
import type { ChatInfo } from "../../src/core/types.ts";

const logger = new Logger("test-factory");

function createMockClient() {
  const forProfileCalls: string[] = [];

  const scoped = {
    listChats: mock(async (): Promise<ChatInfo[]> => []),
    fetchChat: mock(async () => []),
    listModels: mock(async (): Promise<string[]> => []),
    deleteChat: mock(async (_id: string): Promise<void> => {}),
    sendMessage: mock(async (_id: string, _msg: string): Promise<string> => ""),
    startNewChat: mock(async (_msg: string): Promise<{ response: string; conversationId: string }> => ({ response: "", conversationId: "" })),
    profileHasConversation: mock(async (_name: string, _id: string): Promise<boolean> => true),
    models: mock(async (): Promise<string[]> => []),
    forProfile(_name: string) { return scoped as unknown as IGeminiClientService; },
  };

  const base = {
    ...scoped,
    forProfile(name: string): IGeminiClientService {
      forProfileCalls.push(name);
      return scoped as unknown as IGeminiClientService;
    },
  };

  return { base, scoped, forProfileCalls };
}

function createMockProfileManager() {
  return {
    hasStoredCookies: mock((_name: string): boolean => true),
    list: mock((): string[] => ["default"]),
  };
}

describe("getGeminiClient factory contract", () => {
  describe("ListChatsQueryHandler profile forwarding", () => {
    test("with profile field: calls forProfile(name) on the client", async () => {
      const { base, scoped, forProfileCalls } = createMockClient();
      const getGeminiClient = mock(async (): Promise<IGeminiClientService> => base as unknown as IGeminiClientService);
      const profileManager = createMockProfileManager();

      const handler = new ListChatsQueryHandler(getGeminiClient, profileManager, logger);

      await handler.handle({
        type: QUERY_TYPES.LIST_CHATS,
        payload: { profile: "work" },
      });

      expect(getGeminiClient).toHaveBeenCalledTimes(1);
      expect(forProfileCalls).toEqual(["work"]);
      expect(scoped.listChats).toHaveBeenCalledTimes(1);
    });

    test("without profile field: does NOT call forProfile", async () => {
      const { base, forProfileCalls } = createMockClient();
      const getGeminiClient = mock(async (): Promise<IGeminiClientService> => base as unknown as IGeminiClientService);
      const profileManager = createMockProfileManager();

      const handler = new ListChatsQueryHandler(getGeminiClient, profileManager, logger);

      await handler.handle({
        type: QUERY_TYPES.LIST_CHATS,
        payload: {},
      });

      expect(getGeminiClient).toHaveBeenCalledTimes(1);
      expect(forProfileCalls).toEqual([]);
    });

    test("allProfiles mode does not call forProfile on the base client (profile-specific)", async () => {
      const { base, forProfileCalls } = createMockClient();
      const getGeminiClient = mock(async (): Promise<IGeminiClientService> => base as unknown as IGeminiClientService);
      const profileManager = createMockProfileManager();
      profileManager.list = mock((): string[] => ["default", "work"]);

      const handler = new ListChatsQueryHandler(getGeminiClient, profileManager, logger);

      await handler.handle({
        type: QUERY_TYPES.LIST_CHATS,
        payload: { allProfiles: true },
      });

      expect(getGeminiClient).toHaveBeenCalledTimes(1);
      expect(forProfileCalls).toEqual(["default", "work"]);
    });
  });

  describe("DeleteConversationCommandHandler profile forwarding", () => {
    test("with profileName: calls forProfile(name) then deleteChat on the scoped client", async () => {
      const { base, scoped, forProfileCalls } = createMockClient();
      const handler = new DeleteConversationCommandHandler(base as unknown as IGeminiClientService);

      await handler.handle({
        type: COMMAND_TYPES.DELETE_CONVERSATION,
        payload: { conversationId: "test-cid", profileName: "work" },
      });

      expect(forProfileCalls).toEqual(["work"]);
      expect(scoped.deleteChat).toHaveBeenCalledWith("test-cid");
    });

    test("without profileName: does NOT call forProfile", async () => {
      const { base, forProfileCalls } = createMockClient();
      const handler = new DeleteConversationCommandHandler(base as unknown as IGeminiClientService);

      await handler.handle({
        type: COMMAND_TYPES.DELETE_CONVERSATION,
        payload: { conversationId: "test-cid" },
      });

      expect(forProfileCalls).toEqual([]);
    });
  });

  describe("SendMessageCommandHandler profile forwarding", () => {
    test("with profileName: calls forProfile(name) then sendMessage on the scoped client", async () => {
      const { base, scoped, forProfileCalls } = createMockClient();
      const handler = new SendMessageCommandHandler(base as unknown as IGeminiClientService);

      await handler.handle({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId: "test-cid", message: "hello", profileName: "work" },
      });

      expect(forProfileCalls).toEqual(["work"]);
      expect(scoped.sendMessage).toHaveBeenCalledWith("test-cid", "hello");
    });

    test("without profileName: does NOT call forProfile", async () => {
      const { base, forProfileCalls } = createMockClient();
      const handler = new SendMessageCommandHandler(base as unknown as IGeminiClientService);

      await handler.handle({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId: "test-cid", message: "hello" },
      });

      expect(forProfileCalls).toEqual([]);
    });
  });

  describe("StartNewChatCommandHandler profile forwarding", () => {
    test("with profileName: calls forProfile(name) then startNewChat on the scoped client", async () => {
      const { base, scoped, forProfileCalls } = createMockClient();
      const handler = new StartNewChatCommandHandler(base as unknown as IGeminiClientService);

      await handler.handle({
        type: COMMAND_TYPES.START_NEW_CHAT,
        payload: { message: "hello", profileName: "work" },
      });

      expect(forProfileCalls).toEqual(["work"]);
      expect(scoped.startNewChat).toHaveBeenCalledWith("hello");
    });

    test("without profileName: does NOT call forProfile", async () => {
      const { base, forProfileCalls } = createMockClient();
      const handler = new StartNewChatCommandHandler(base as unknown as IGeminiClientService);

      await handler.handle({
        type: COMMAND_TYPES.START_NEW_CHAT,
        payload: { message: "hello" },
      });

      expect(forProfileCalls).toEqual([]);
    });
  });
});
