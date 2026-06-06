import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  ListChatsQueryHandler,
  FetchChatQueryHandler,
  GetProfileStatusesQueryHandler,
  GetAuthStatusQueryHandler,
  ListModelsQueryHandler,
  QUERY_TYPES,
} from "../../src/core/query-handlers.ts";
import type { IGeminiClientQueryService, IProfileQueryService } from "../../src/core/query-handlers.ts";
import type { Query } from "../../src/core/mediator.ts";

function makeQuery<T>(type: string, payload: T): Query<T> {
  return { type, payload: payload as unknown as Record<string, unknown> };
}

describe("ListChatsQueryHandler", () => {
  let mockClient: IGeminiClientQueryService;

  beforeEach(() => {
    mockClient = {
      listChats: mock(() => Promise.resolve([])),
      fetchChat: mock(() => Promise.resolve([])),
      listModels: mock(() => Promise.resolve([])),
    };
  });

  test("has correct queryType", () => {
    const handler = new ListChatsQueryHandler(mockClient);
    expect(handler.queryType).toBe(QUERY_TYPES.LIST_CHATS);
  });

  test("returns chats from gemini client", async () => {
    const chats = [
      { id: "1", title: "Chat 1", isPinned: false, timestamp: 1000 },
      { id: "2", title: "Chat 2", isPinned: true, timestamp: 2000 },
    ];
    mockClient.listChats = mock(() => Promise.resolve(chats));

    const handler = new ListChatsQueryHandler(mockClient);
    const result = await handler.handle(makeQuery(QUERY_TYPES.LIST_CHATS, {}));
    expect(result.chats).toEqual(chats);
  });

  test("passes limit, offset, search options", async () => {
    mockClient.listChats = mock((opts) => {
      expect(opts).toEqual({ limit: 10, offset: 5, search: "hello" });
      return Promise.resolve([]);
    });

    const handler = new ListChatsQueryHandler(mockClient);
    await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { limit: 10, offset: 5, search: "hello" }),
    );
    expect(mockClient.listChats).toHaveBeenCalledTimes(1);
  });
});

describe("FetchChatQueryHandler", () => {
  let mockClient: IGeminiClientQueryService;

  beforeEach(() => {
    mockClient = {
      listChats: mock(() => Promise.resolve([])),
      fetchChat: mock(() => Promise.resolve([])),
      listModels: mock(() => Promise.resolve([])),
    };
  });

  test("has correct queryType", () => {
    const handler = new FetchChatQueryHandler(mockClient);
    expect(handler.queryType).toBe(QUERY_TYPES.FETCH_CHAT);
  });

  test("returns messages for conversation", async () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "model" as const, content: "Hi there!" },
    ];
    mockClient.fetchChat = mock(() => Promise.resolve(messages));

    const handler = new FetchChatQueryHandler(mockClient);
    const result = await handler.handle(
      makeQuery(QUERY_TYPES.FETCH_CHAT, { conversationId: "conv-123" }),
    );
    expect(result.messages).toEqual(messages);
    expect(mockClient.fetchChat).toHaveBeenCalledWith("conv-123");
  });
});

describe("GetProfileStatusesQueryHandler", () => {
  let mockProfileService: IProfileQueryService;

  beforeEach(() => {
    mockProfileService = {
      getProfileStatuses: mock(() => Promise.resolve([])),
      getAuthStatus: mock(() => Promise.resolve({ authenticated: false, profileName: null })),
    };
  });

  test("has correct queryType", () => {
    const handler = new GetProfileStatusesQueryHandler(mockProfileService);
    expect(handler.queryType).toBe(QUERY_TYPES.GET_PROFILE_STATUSES);
  });

  test("returns profile statuses", async () => {
    const statuses = [
      {
        name: "default",
        exists: true,
        isActive: true,
        expiresAt: "2099-01-01T00:00:00Z",
        isDefault: true,
      },
    ];
    mockProfileService.getProfileStatuses = mock(() => Promise.resolve(statuses));

    const handler = new GetProfileStatusesQueryHandler(mockProfileService);
    const result = await handler.handle(makeQuery(QUERY_TYPES.GET_PROFILE_STATUSES, {}));
    expect(result.statuses).toEqual(statuses);
  });
});

describe("GetAuthStatusQueryHandler", () => {
  let mockProfileService: IProfileQueryService;

  beforeEach(() => {
    mockProfileService = {
      getProfileStatuses: mock(() => Promise.resolve([])),
      getAuthStatus: mock(() => Promise.resolve({ authenticated: false, profileName: null })),
    };
  });

  test("has correct queryType", () => {
    const handler = new GetAuthStatusQueryHandler(mockProfileService);
    expect(handler.queryType).toBe(QUERY_TYPES.GET_AUTH_STATUS);
  });

  test("returns authenticated true with profile name", async () => {
    mockProfileService.getAuthStatus = mock(() =>
      Promise.resolve({ authenticated: true, profileName: "default" }),
    );

    const handler = new GetAuthStatusQueryHandler(mockProfileService);
    const result = await handler.handle(makeQuery(QUERY_TYPES.GET_AUTH_STATUS, {}));
    expect(result.authenticated).toBe(true);
    expect(result.profileName).toBe("default");
  });

  test("returns authenticated false with null profile name", async () => {
    mockProfileService.getAuthStatus = mock(() =>
      Promise.resolve({ authenticated: false, profileName: null }),
    );

    const handler = new GetAuthStatusQueryHandler(mockProfileService);
    const result = await handler.handle(makeQuery(QUERY_TYPES.GET_AUTH_STATUS, {}));
    expect(result.authenticated).toBe(false);
    expect(result.profileName).toBeNull();
  });
});

describe("ListModelsQueryHandler", () => {
  let mockClient: IGeminiClientQueryService;

  beforeEach(() => {
    mockClient = {
      listChats: mock(() => Promise.resolve([])),
      fetchChat: mock(() => Promise.resolve([])),
      listModels: mock(() => Promise.resolve([])),
    };
  });

  test("has correct queryType", () => {
    const handler = new ListModelsQueryHandler(mockClient);
    expect(handler.queryType).toBe(QUERY_TYPES.LIST_MODELS);
  });

  test("returns models from gemini client", async () => {
    const models = ["gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash"];
    mockClient.listModels = mock(() => Promise.resolve(models));

    const handler = new ListModelsQueryHandler(mockClient);
    const result = await handler.handle(makeQuery(QUERY_TYPES.LIST_MODELS, {}));
    expect(result.models).toEqual(models);
  });
});
