import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Logger } from "../../src/infrastructure/logger.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";
import type { Cookie } from "../../src/core/types.ts";

interface RawChatInfo {
  cid: string;
  title: string;
  is_pinned: boolean;
  timestamp: number;
}

interface RawChatTurn {
  role: "user" | "model";
  text: string;
}

interface RawChatHistory {
  cid: string;
  turns: RawChatTurn[];
}

interface RawModelOutput {
  text: { toString(): string };
  rcid: string;
}

interface RawAvailableModel {
  model_id: string;
  model_name: string;
  display_name: string;
}

interface RawChatSession {
  sendMessage(opts: { prompt: string }): Promise<RawModelOutput>;
  readHistory(limit?: number): Promise<RawChatHistory | null>;
  cid: string;
  rcid: string;
}

interface RawGeminiClient {
  init(opts?: {
    timeout?: number;
    autoClose?: boolean;
    closeDelay?: number;
    autoRefresh?: boolean;
    refreshInterval?: number;
    verbose?: boolean;
    watchdogTimeout?: number;
  }): Promise<void>;
  listChats(): RawChatInfo[] | null;
  readChat(cid: string, limit?: number): Promise<RawChatHistory | null>;
  startChat(opts?: { metadata?: (string | null)[] | null; cid?: string; rid?: string; rcid?: string }): RawChatSession;
  deleteChat(cid: string): Promise<void>;
  listModels(): RawAvailableModel[] | null;
}

class MockAuthError extends Error {
  name = "AuthError" as const;
}

class MockTimeoutError extends Error {
  name = "TimeoutError" as const;
}

class MockUsageLimitExceeded extends Error {
  name = "UsageLimitExceeded" as const;
}

class MockTemporarilyBlocked extends Error {
  name = "TemporarilyBlocked" as const;
}

class MockModelInvalid extends Error {
  name = "ModelInvalid" as const;
}

class MockAPIError extends Error {
  name = "APIError" as const;
}

class MockGeminiError extends Error {
  name = "GeminiError" as const;
}

let mockClientInstances: RawGeminiClient[];
let mockClientConstructorCallCount: number;
let mockOverrides: {
  listChats?: RawChatInfo[] | null;
  readChat?: (cid: string) => RawChatHistory | null;
  startChat?: (opts?: { cid?: string }) => RawChatSession;
  deleteChat?: (cid: string) => Promise<void>;
  listModels?: RawAvailableModel[] | null;
  initImplementation?: (client: RawGeminiClient) => void;
  listChatsImplementation?: () => never;
} | undefined;

function createMockChatInfo(overrides?: Partial<RawChatInfo>): RawChatInfo {
  return { cid: "cid1", title: "Test Chat", is_pinned: false, timestamp: 1700000000000, ...overrides };
}

function createMockChatHistory(turns: RawChatTurn[]): RawChatHistory {
  return { cid: "conv1", turns };
}

function createMockChatTurn(role: "user" | "model", text: string): RawChatTurn {
  return { role, text };
}

function createMockModelOutput(text: string, rcid = "rcid1"): RawModelOutput {
  return { text: { toString: () => text }, rcid };
}

function createMockAvailableModel(overrides?: Partial<RawAvailableModel>): RawAvailableModel {
  return {
    model_id: "gemini-2.5",
    model_name: "Gemini 2.5",
    display_name: "Gemini 2.5 Flash",
    ...overrides,
  };
}

function createMockCookieStorage(profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {}): CookieStorage {
  const storage: CookieStorage = {
    save: () => {},
    load: (profileName: string): Cookie[] => {
      const cookies = profileCookies[profileName] ?? { secure_1psid: "", secure_1psidts: null };
      const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const result: Cookie[] = [];
      if (cookies.secure_1psid) {
        result.push({ name: "__Secure-1PSID", value: cookies.secure_1psid, domain: ".google.com", path: "/", expires: farFuture, httpOnly: true, secure: true, sameSite: "Lax" as const });
      }
      if (cookies.secure_1psidts) {
        result.push({ name: "__Secure-1PSIDTS", value: cookies.secure_1psidts, domain: ".google.com", path: "/", expires: farFuture, httpOnly: true, secure: true, sameSite: "Lax" as const });
      }
      return result;
    },
    delete: () => {},
    list: () => Object.keys(profileCookies),
  };
  return storage;
}

function installGeminiReverseMock(overrides?: typeof mockOverrides) {
  mockClientInstances = [];
  mockClientConstructorCallCount = 0;
  mockOverrides = overrides;

  const mockGeminiClientFactory = function(config?: { secure_1psid?: string; secure_1psidts?: string | null }) {
    mockClientConstructorCallCount++;
    const instance: RawGeminiClient & { secure_1psid?: string; secure_1psidts?: string | null } = {
      init: mock(async function(this: RawGeminiClient) {
        if (mockOverrides?.initImplementation) {
          mockOverrides.initImplementation(instance);
        }
      }),
      listChats: mock(function(this: RawGeminiClient) {
        if (mockOverrides?.listChatsImplementation) {
          throw mockOverrides.listChatsImplementation();
        }
        return mockOverrides?.listChats ?? null;
      }),
      readChat: mock(async function(this: RawGeminiClient, cid: string) {
        return mockOverrides?.readChat?.(cid) ?? null;
      }),
      startChat: mock(function(this: RawGeminiClient, opts?: { cid?: string }) {
        const cid = opts?.cid ?? "new-cid";
        const session: RawChatSession = {
          sendMessage: mock(async function(this: RawChatSession, _opts: { prompt: string }) {
            return createMockModelOutput("response text", cid);
          }),
          readHistory: mock(async function(this: RawChatSession, _limit?: number) {
            return null;
          }),
          cid,
          rcid: "rcid-" + cid,
        };
        if (mockOverrides?.startChat) {
          return mockOverrides.startChat(opts) ?? session;
        }
        return session;
      }),
      deleteChat: mock(async function(this: RawGeminiClient, cid: string) {
        if (mockOverrides?.deleteChat) {
          await mockOverrides.deleteChat(cid);
        }
      }),
      listModels: mock(() => mockOverrides?.listModels ?? null),
    };
    instance.secure_1psid = config?.secure_1psid;
    instance.secure_1psidts = config?.secure_1psidts;
    mockClientInstances.push(instance);
    return instance;
  };

  const mockModule = {
    get GeminiClient() { return mockGeminiClientFactory; },
    AuthError: MockAuthError,
    TimeoutError: MockTimeoutError,
    UsageLimitExceeded: MockUsageLimitExceeded,
    TemporarilyBlocked: MockTemporarilyBlocked,
    ModelInvalid: MockModelInvalid,
    APIError: MockAPIError,
    GeminiError: MockGeminiError,
    ChatInfo: class {},
    ChatHistory: class {},
    ChatTurn: class {},
    ModelOutput: class {},
    AvailableModel: class {},
    ChatSession: class {},
  };

  mock.module("gemini-reverse", () => mockModule);
}

describe("GeminiClientService", () => {
  let logger: Logger;
  let cookieStorageService: CookieStorageService;

  beforeEach(async () => {
    logger = new Logger("test");
    const storage = createMockCookieStorage();
    cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
  });

  afterEach(() => {
    mock.restore();
  });

  describe("listChats", () => {
    test("maps cid to id and is_pinned to isPinned", async () => {
      installGeminiReverseMock({
        listChats: [
          createMockChatInfo({ cid: "chat-1", title: "First Chat", is_pinned: true, timestamp: 1700000000000 }),
          createMockChatInfo({ cid: "chat-2", title: "Second Chat", is_pinned: false, timestamp: 1699000000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats();

      expect(chats[0].id).toBe("chat-1");
      expect(chats[0].title).toBe("First Chat");
      expect(chats[0].isPinned).toBe(true);
      expect(chats[1].id).toBe("chat-2");
      expect(chats[1].isPinned).toBe(false);
    });

    test("applies search filter", async () => {
      installGeminiReverseMock({
        listChats: [
          createMockChatInfo({ cid: "1", title: "Python Help" }),
          createMockChatInfo({ cid: "2", title: "JavaScript Help" }),
          createMockChatInfo({ cid: "3", title: "Python Tips" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats({ search: "python" });

      expect(chats).toHaveLength(2);
      expect(chats[0].title).toBe("Python Help");
      expect(chats[1].title).toBe("Python Tips");
    });

    test("applies limit and offset", async () => {
      installGeminiReverseMock({
        listChats: [
          createMockChatInfo({ cid: "1", title: "Chat 1", timestamp: 1700000000 }),
          createMockChatInfo({ cid: "2", title: "Chat 2", timestamp: 1699000000 }),
          createMockChatInfo({ cid: "3", title: "Chat 3", timestamp: 1698000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats({ limit: 1, offset: 1 });

      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe("2");
    });

    test("sorts by timestamp descending", async () => {
      installGeminiReverseMock({
        listChats: [
          createMockChatInfo({ cid: "1", title: "Older", timestamp: 1000000000 }),
          createMockChatInfo({ cid: "2", title: "Newer", timestamp: 2000000000 }),
          createMockChatInfo({ cid: "3", title: "Middle", timestamp: 1500000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats();

      expect(chats[0].title).toBe("Newer");
      expect(chats[1].title).toBe("Middle");
      expect(chats[2].title).toBe("Older");
    });

    test("converts timestamp from seconds to milliseconds", async () => {
      installGeminiReverseMock({
        listChats: [
          createMockChatInfo({ cid: "1", title: "Chat", timestamp: 1700000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats();

      expect(chats[0].timestamp).toBe(1700000000000);
    });

    test("timestamp produces valid date (not epoch 1970)", async () => {
      installGeminiReverseMock({
        listChats: [
          createMockChatInfo({ cid: "1", title: "Chat", timestamp: 1700000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats();

      const chatDate = new Date(chats[0].timestamp);
      expect(chatDate.getFullYear()).toBeGreaterThan(2000);
    });

    test("attaches profile when forProfile was used", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      installGeminiReverseMock({
        listChats: [createMockChatInfo({ cid: "1", title: "Profile Chat" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css);
      const profileService = service.forProfile("work");

      const chats = await profileService.listChats();

      expect(chats[0].profile).toBe("work");
    });

    test("returns empty array when listChats returns null", async () => {
      installGeminiReverseMock({ listChats: null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const chats = await service.listChats();

      expect(chats).toEqual([]);
    });
  });

  describe("fetchChat", () => {
    test("flattens turns text correctly", async () => {
      installGeminiReverseMock({
        readChat: (_cid: string) =>
          createMockChatHistory([
            createMockChatTurn("user", "Hello"),
            createMockChatTurn("model", "Hi there!"),
          ]),
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const messages = await service.fetchChat("conv-123");

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
      expect(messages[1].role).toBe("model");
      expect(messages[1].content).toBe("Hi there!");
    });

    test("returns empty array when readChat returns null", async () => {
      installGeminiReverseMock({ readChat: () => null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const messages = await service.fetchChat("nonexistent");

      expect(messages).toEqual([]);
    });
  });

  describe("sendMessage", () => {
    test("returns output.text", async () => {
      installGeminiReverseMock({
        startChat: (opts) => {
          const cid = opts?.cid ?? "conv-1";
          return {
            sendMessage: mock(async () => createMockModelOutput("model response", cid)),
            readHistory: mock(async () => null),
            cid,
            rcid: "rcid-1",
          };
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const result = await service.sendMessage("conv-1", "hello");

      expect(result).toBe("model response");
    });
  });

  describe("startNewChat", () => {
    test("returns output.text and ChatSession.cid", async () => {
      installGeminiReverseMock({});

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const result = await service.startNewChat("Hello Gemini");

      expect(result.response).toBe("response text");
      expect(result.conversationId).toBe("new-cid");
    });
  });

  describe("deleteChat", () => {
    test("calls client.deleteChat with cid", async () => {
      let deletedCid: string | null = null;
      installGeminiReverseMock({
        deleteChat: async (cid: string) => {
          deletedCid = cid;
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await service.deleteChat("conv-to-delete");

      expect(deletedCid).toBe("conv-to-delete");
    });
  });

  describe("listModels", () => {
    test("returns display_name when present", async () => {
      installGeminiReverseMock({
        listModels: [
          createMockAvailableModel({ model_id: "gemini-2.5", model_name: "Gemini 2.5", display_name: "Gemini 2.5 Flash" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const models = await service.listModels();

      expect(models).toEqual(["Gemini 2.5 Flash"]);
    });

    test("falls back to model_name when display_name is missing", async () => {
      installGeminiReverseMock({
        listModels: [
          createMockAvailableModel({ model_id: "gemini-2.5", model_name: "Gemini 2.5", display_name: "" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const models = await service.listModels();

      expect(models).toEqual(["Gemini 2.5"]);
    });

    test("falls back to model_id when display_name and model_name are missing", async () => {
      installGeminiReverseMock({
        listModels: [
          createMockAvailableModel({ model_id: "gemini-ultra", model_name: "", display_name: "" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const models = await service.listModels();

      expect(models).toEqual(["gemini-ultra"]);
    });

    test("returns empty array when listModels returns null", async () => {
      installGeminiReverseMock({ listModels: null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      const models = await service.listModels();

      expect(models).toEqual([]);
    });
  });

  describe("error translations", () => {
    test("AuthError -> AuthenticationError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockAuthError("auth failure");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("Session expired or invalid");
    });

    test("TimeoutError -> GeminiAPIError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockTimeoutError("timeout");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("Request to Gemini timed out");
    });

    test("UsageLimitExceeded -> GeminiAPIError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockUsageLimitExceeded("usage exceeded");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("Gemini usage limit reached");
    });

    test("TemporarilyBlocked -> GeminiAPIError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockTemporarilyBlocked("blocked");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("Temporarily blocked by Gemini");
    });

    test("ModelInvalid -> GeminiAPIError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockModelInvalid("model invalid");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("Model is invalid or unavailable");
    });

    test("APIError -> GeminiAPIError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockAPIError("api error occurred");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("api error occurred");
    });

    test("GeminiError -> GeminiAPIError", async () => {
      installGeminiReverseMock({
        listChatsImplementation: () => {
          throw new MockGeminiError("generic gemini error");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await expect(service.listChats()).rejects.toThrow("generic gemini error");
    });
  });

  describe("forProfile", () => {
    test("creates a brand-new GeminiClient instance", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: "work-ts" },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      installGeminiReverseMock({ listChats: [createMockChatInfo({ cid: "1", title: "Work Chat" })] });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css);
      const callCountBefore = mockClientConstructorCallCount;

      service.forProfile("work");
      const newCallCount = mockClientConstructorCallCount;

      expect(newCallCount - callCountBefore).toBe(1);
    });

    test("new instance listChats is scoped to profile cookies", async () => {
      let receivedSid = "";
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      installGeminiReverseMock({
        initImplementation: (client) => {
          receivedSid = (client as unknown as { secure_1psid?: string }).secure_1psid ?? "";
        },
        listChats: [createMockChatInfo({ cid: "work-1", title: "Work Chat" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css);

      const profileService = service.forProfile("work");
      await profileService.listChats();

      expect(receivedSid).toBe("work-sid");
    });
  });

  describe("init() idempotency", () => {
    test("calls client.init exactly once even when called multiple times", async () => {
      let initCallCount = 0;
      installGeminiReverseMock({
        initImplementation: () => {
          initCallCount++;
        },
        listChats: [createMockChatInfo()],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger);

      await service.listChats();
      await service.listChats();
      await service.listChats();

      expect(initCallCount).toBe(1);
    });
  });

  describe("empty-cookies factory case", () => {
    test("init resolves without throwing when secure1psid is empty string", async () => {
      installGeminiReverseMock({});

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "" }, logger);

      await service.listChats();
      expect(service.isAuthenticated()).toBe(true);
    });
  });
});