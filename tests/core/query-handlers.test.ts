import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  ListChatsQueryHandler,
  FetchChatQueryHandler,
  GetProfileStatusesQueryHandler,
  GetAuthStatusQueryHandler,
  ListModelsQueryHandler,
  QUERY_TYPES,
} from "../../src/core/query-handlers.ts";
import type { IGeminiClientQueryService, IProfileQueryService, ProfileManagerForQuery } from "../../src/core/query-handlers.ts";
import type { Query } from "../../src/core/mediator.ts";
import { Logger } from "../../src/infrastructure/logger.ts";

function makeQuery<T>(type: string, payload: T): Query<T> {
  return { type, payload: payload as unknown as Record<string, unknown> };
}

describe("ListChatsQueryHandler", () => {
  let mockClient: IGeminiClientQueryService & { forProfile: (name: string) => IGeminiClientQueryService };
  let mockProfileManager: ProfileManagerForQuery;
  let mockLogger: Logger;
  let warnCalls: string[];

  beforeEach(() => {
    mockClient = {
      listChats: mock(() => Promise.resolve([])),
      fetchChat: mock(() => Promise.resolve([])),
      listModels: mock(() => Promise.resolve([])),
      forProfile: (name: string) => mockClient,
    };
    warnCalls = [];
    mockLogger = {
      warn: (msg: string, ..._args: unknown[]) => { warnCalls.push(msg); },
      debug: () => {},
      info: () => {},
      error: () => {},
    } as Logger;
    mockProfileManager = {
      hasStoredCookies: mock(() => true),
      list: mock(() => ["work", "personal", "test"]),
    };
  });

  test("has correct queryType", () => {
    const handler = new ListChatsQueryHandler(() => mockClient as any, mockProfileManager, mockLogger);
    expect(handler.queryType).toBe(QUERY_TYPES.LIST_CHATS);
  });

  test("returns chats from gemini client", async () => {
    const chats = [
      { id: "1", title: "Chat 1", isPinned: false, timestamp: 1000 },
      { id: "2", title: "Chat 2", isPinned: true, timestamp: 2000 },
    ];
    mockClient.listChats = mock(() => Promise.resolve(chats));

    const handler = new ListChatsQueryHandler(() => mockClient as any, mockProfileManager, mockLogger);
    const result = await handler.handle(makeQuery(QUERY_TYPES.LIST_CHATS, {}));
    expect(result.chats).toEqual(chats);
  });

  test("passes limit, offset, search options", async () => {
    mockClient.listChats = mock((opts) => {
      expect(opts).toEqual({ limit: 10, offset: 5, search: "hello" });
      return Promise.resolve([]);
    });

    const handler = new ListChatsQueryHandler(() => mockClient as any, mockProfileManager, mockLogger);
    await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { limit: 10, offset: 5, search: "hello" }),
    );
    expect(mockClient.listChats).toHaveBeenCalledTimes(1);
  });

  test("routes to forProfile(name) when profile is set in payload", async () => {
    const profileClient = {
      ...mockClient,
      listChats: mock(() =>
        Promise.resolve([{ id: "p1", title: "P chat", isPinned: false, timestamp: 1, profile: "work" }]),
      ),
    };
    const forProfileSpy = mock((_name: string) => profileClient as any);
    const handler = new ListChatsQueryHandler(
      () => ({ ...mockClient, forProfile: forProfileSpy } as any),
      mockProfileManager,
      mockLogger,
    );

    const result = await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { profile: "work", search: "foo" }),
    );

    expect(forProfileSpy).toHaveBeenCalledTimes(1);
    expect(forProfileSpy.mock.calls[0][0]).toBe("work");
    expect(profileClient.listChats).toHaveBeenCalledWith({
      limit: undefined,
      offset: undefined,
      search: "foo",
    });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].id).toBe("p1");
  });

  test("profile takes precedence over allProfiles", async () => {
    const profileClient = {
      ...mockClient,
      listChats: mock(() => Promise.resolve([])),
    };
    const forProfileSpy = mock((_name: string) => profileClient as any);
    const profileManagerSpy = { ...mockProfileManager, list: mock(() => ["work", "personal"]) };

    const handler = new ListChatsQueryHandler(
      () => ({ ...mockClient, forProfile: forProfileSpy } as any),
      profileManagerSpy,
      mockLogger,
    );

    await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { profile: "work", allProfiles: true }),
    );

    expect(forProfileSpy).toHaveBeenCalledTimes(1);
    expect(forProfileSpy.mock.calls[0][0]).toBe("work");
    expect(profileManagerSpy.list).not.toHaveBeenCalled();
  });

  test("allProfiles filters out unauthenticated profiles", async () => {
    const chats = [{ id: "1", title: "Chat", isPinned: false, timestamp: 1000 }];
    mockClient.listChats = mock(() => Promise.resolve(chats));
    mockProfileManager.hasStoredCookies = mock((name: string) => name !== "personal");
    mockProfileManager.list = mock(() => ["work", "personal", "test"]);

    const handler = new ListChatsQueryHandler(() => mockClient as any, mockProfileManager, mockLogger);
    const result = await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { allProfiles: true }),
    );

    expect(result.chats).toHaveLength(2);
    expect(warnCalls).toEqual(["Skipping unauthenticated profile 'personal'"]);
  });

  test("allProfiles with no authenticated profiles returns empty chats", async () => {
    mockProfileManager.hasStoredCookies = mock(() => false);
    mockProfileManager.list = mock(() => ["work", "personal"]);

    const handler = new ListChatsQueryHandler(() => mockClient as any, mockProfileManager, mockLogger);
    const result = await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { allProfiles: true }),
    );

    expect(result.chats).toEqual([]);
    expect(warnCalls).toEqual([
      "Skipping unauthenticated profile 'work'",
      "Skipping unauthenticated profile 'personal'",
    ]);
  });

  test("allProfiles includes profiles with near-expiry cookies (no freshness gate for listing)", async () => {
    const chats = [{ id: "1", title: "Chat", isPinned: false, timestamp: 1000 }];
    mockClient.listChats = mock(() => Promise.resolve(chats));
    mockProfileManager.hasStoredCookies = mock(() => true);
    mockProfileManager.list = mock(() => ["work", "personal"]);

    const handler = new ListChatsQueryHandler(() => mockClient as any, mockProfileManager, mockLogger);
    const result = await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { allProfiles: true }),
    );

    expect(result.chats).toHaveLength(2);
    expect(warnCalls).toEqual([]);
  });

  test("allProfiles with allSettled — partial results on one profile failure", async () => {
    const workChats = [{ id: "w1", title: "Work Chat", isPinned: false, timestamp: 2000 }];
    const testChats = [{ id: "t1", title: "Test Chat", isPinned: false, timestamp: 1000 }];

    const workClient = {
      listChats: mock(() => Promise.resolve(workChats)),
    };
    const testClient = {
      listChats: mock(() => Promise.resolve(testChats)),
    };
    const personalClient = {
      listChats: mock(() => Promise.reject(new Error("API failure"))),
    };

    const forProfileSpy = mock((name: string) => {
      if (name === "work") return workClient as any;
      if (name === "test") return testClient as any;
      return personalClient as any;
    });

    mockProfileManager.hasStoredCookies = mock(() => true);
    mockProfileManager.list = mock(() => ["work", "test", "personal"]);

    const handler = new ListChatsQueryHandler(
      () => ({ forProfile: forProfileSpy } as any),
      mockProfileManager,
      mockLogger,
    );

    const result = await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { allProfiles: true }),
    );

    expect(result.chats).toHaveLength(2);
    expect(result.chats[0].id).toBe("w1");
    expect(result.chats[1].id).toBe("t1");
    expect(warnCalls.some((c) => c.includes("Failed to list chats for profile"))).toBe(true);
  });

  test("allProfiles where all profiles reject returns empty chats with warnings", async () => {
    mockProfileManager.hasStoredCookies = mock(() => true);
    mockProfileManager.list = mock(() => ["work", "personal"]);

    const forProfileSpy = mock((_name: string) => ({
      listChats: mock(() => Promise.reject(new Error("API error"))),
    }) as any);

    const handler = new ListChatsQueryHandler(
      () => ({ forProfile: forProfileSpy } as any),
      mockProfileManager,
      mockLogger,
    );

    const result = await handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { allProfiles: true }),
    );

    expect(result.chats).toEqual([]);
    expect(warnCalls.filter((c) => c.includes("Failed to list chats for profile")).length).toBe(2);
  });

  test("single profile query bypasses auth check and propagates errors", async () => {
    const error = new Error("Profile-specific API failure");
    const profileClient = {
      listChats: mock(() => Promise.reject(error)),
    };
    const forProfileSpy = mock((_name: string) => profileClient as any);

    const handler = new ListChatsQueryHandler(
      () => ({ forProfile: forProfileSpy } as any),
      mockProfileManager,
      mockLogger,
    );

    await expect(handler.handle(
      makeQuery(QUERY_TYPES.LIST_CHATS, { profile: "work" }),
    )).rejects.toThrow("Profile-specific API failure");

    expect(mockProfileManager.hasStoredCookies).not.toHaveBeenCalled();
  });
});

describe("FetchChatQueryHandler", () => {
  let mockClient: IGeminiClientQueryService;
  let profileClient: { fetchChat: ReturnType<typeof mock>; listChats: ReturnType<typeof mock>; listModels: ReturnType<typeof mock> };

  beforeEach(() => {
    profileClient = {
      fetchChat: mock(() => Promise.resolve([])),
      listChats: mock(() => Promise.resolve([])),
      listModels: mock(() => Promise.resolve([])),
    };
    mockClient = {
      listChats: mock(() => Promise.resolve([])),
      fetchChat: mock(() => Promise.resolve([])),
      listModels: mock(() => Promise.resolve([])),
      forProfile: mock(() => profileClient as unknown as IGeminiClientQueryService),
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

  test("routes to forProfile(profileName).fetchChat when profileName is set", async () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "model" as const, content: "Hi there!" },
    ];
    profileClient.fetchChat = mock(() => Promise.resolve(messages));

    const handler = new FetchChatQueryHandler(mockClient);
    const result = await handler.handle(
      makeQuery(QUERY_TYPES.FETCH_CHAT, { conversationId: "conv-evs", profileName: "evs-diegohb" }),
    );

    expect(mockClient.forProfile).toHaveBeenCalledWith("evs-diegohb");
    expect(profileClient.fetchChat).toHaveBeenCalledWith("conv-evs");
    expect(mockClient.fetchChat).not.toHaveBeenCalled();
    expect(result.messages).toEqual(messages);
  });

  test("uses default client when profileName is absent", async () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
    ];
    mockClient.fetchChat = mock(() => Promise.resolve(messages));

    const handler = new FetchChatQueryHandler(mockClient);
    await handler.handle(makeQuery(QUERY_TYPES.FETCH_CHAT, { conversationId: "conv-1" }));

    expect(mockClient.forProfile).not.toHaveBeenCalled();
    expect(mockClient.fetchChat).toHaveBeenCalledWith("conv-1");
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
