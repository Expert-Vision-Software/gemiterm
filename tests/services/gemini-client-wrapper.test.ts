import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Logger } from "../../src/infrastructure/logger.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { ChatMetadataStorage } from "../../src/services/chat-metadata-storage.ts";
import { setupTestConfig, teardownTestConfig } from "../setup.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { GeminiClientDeps } from "../../src/services/gemini-client-wrapper.ts";

interface RawChatRow {
  cid: string;
  title: string;
  pinned: boolean;
  timestamp: number;
}

interface RawChatTurn {
  role: string;
  text: string;
  rid?: string;
  rcid?: string;
}

interface RawAvailableModel {
  model_id: string;
  model_name?: string;
  display_name?: string;
}

interface RawModelOutput {
  text: { toString(): string };
  cid?: string;
  metadata?: (string | null)[];
}

interface RawChatSession {
  cid: string;
  metadata?: (string | null)[];
  generateContent(opts: { prompt: string }): Promise<RawModelOutput>;
}

interface RawGemini {
  init(): Promise<void>;
  chats(): Promise<RawChatRow[]>;
  readChat(cid: string, limit?: number): Promise<RawChatTurn[]>;
  newChat(): RawChatSession;
  deleteChat(cid: string): Promise<void>;
  models(): Promise<RawAvailableModel[]>;
}

class MockAuthError extends Error {
  name = "AuthError" as const;
}

class MockGeminiError extends Error {
  name = "GeminiError" as const;
  constructor(msg: string) { super(msg); }
}

class MockUsageLimitExceeded extends MockGeminiError {
  name = "UsageLimitExceeded" as const;
  constructor(msg: string) { super(msg); }
}

class MockTemporarilyBlocked extends MockGeminiError {
  name = "TemporarilyBlocked" as const;
  constructor(msg: string) { super(msg); }
}

class MockModelInvalid extends MockGeminiError {
  name = "ModelInvalid" as const;
  constructor(msg: string) { super(msg); }
}

class MockAPIError extends Error {
  name = "APIError" as const;
  constructor(msg: string) { super(msg); }
}

let mockClientInstances: RawGemini[];
let mockClientConstructorCallCount: number;
let mockOverrides: {
  chats?: RawChatRow[] | null;
  readChat?: (cid: string, limit?: number) => RawChatTurn[] | null;
  newChat?: () => RawChatSession;
  deleteChat?: (cid: string) => Promise<void>;
  models?: RawAvailableModel[] | null;
  initImplementation?: (client: RawGemini) => void;
  chatsImplementation?: () => never;
} | undefined;

function createMockChatRow(overrides?: Partial<RawChatRow>): RawChatRow {
  return { cid: "cid1", title: "Test Chat", pinned: false, timestamp: 1700000000000, ...overrides };
}

function createMockChatTurn(role: "user" | "model", text: string, rid?: string, rcid?: string): RawChatTurn {
  return { role, text, rid, rcid };
}

function createMockModelOutput(text: string): RawModelOutput {
  return { text: { toString: () => text } };
}

function createMockAvailableModel(overrides?: Partial<RawAvailableModel>): RawAvailableModel {
  return {
    model_id: "gemini-2.5",
    model_name: "Gemini 2.5",
    display_name: "Gemini 2.5 Flash",
    ...overrides,
  };
}

function createMockSession(initialCid = "new-cid", responseText = "response text"): RawChatSession {
  let _cid = initialCid;
  return {
    get cid() { return _cid; },
    set cid(v: string) { _cid = v; },
    generateContent: mock(async function(this: RawChatSession, _opts: { prompt: string }) {
      return createMockModelOutput(responseText);
    }),
  };
}

function createMetadataAwareSession(initialCid = "new-cid", responseText = "response text", responseMetadata?: (string | null)[]): { session: RawChatSession; capture: { newChatMetadata: (string | null)[] | null; generateMetadata: (string | null)[] | null } } {
  const capture = { newChatMetadata: null as (string | null)[] | null, generateMetadata: null as (string | null)[] | null };
  let _cid = initialCid;
  let _meta: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];

  const session: RawChatSession = {
    get cid() { return _cid; },
    set cid(v: string) { _cid = v; },
    get metadata() { return _meta; },
    set metadata(v: (string | null)[]) {
      if (!Array.isArray(v)) return;
      for (let i = 0; i < v.length && i < 10; i++) {
        if (v[i] != null) _meta[i] = v[i];
      }
    },
    generateContent: mock(async function(this: RawChatSession, _opts: { prompt: string }) {
      capture.generateMetadata = [...this.metadata];
      const result: RawModelOutput = { text: { toString: () => responseText }, cid: _cid };
      if (responseMetadata) {
        result.metadata = [...responseMetadata];
      }
      return result;
    }),
  };

  return { session, capture };
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

function installGeminiReverseMock(overrides?: typeof mockOverrides): GeminiClientDeps {
  mockClientInstances = [];
  mockClientConstructorCallCount = 0;
  mockOverrides = overrides;

  const mockGeminiFactory = function(config?: { secure_1psid?: string; timeout?: number; autoClose?: boolean }) {
    mockClientConstructorCallCount++;
    const cookies: Record<string, string> = {};
    if (config?.secure_1psid) cookies["__Secure-1PSID"] = config.secure_1psid;
    const session = createMockSession();

    const instance: RawGemini & { cookies: Record<string, string> } = {
      cookies,
      init: mock(async function(this: RawGemini) {
        if (mockOverrides?.initImplementation) {
          mockOverrides.initImplementation(instance);
        }
      }),
      chats: mock(async function(this: RawGemini) {
        if (mockOverrides?.chatsImplementation) {
          throw mockOverrides.chatsImplementation();
        }
        return mockOverrides?.chats ?? null;
      }),
      readChat: mock(async function(this: RawGemini, cid: string, limit?: number) {
        return mockOverrides?.readChat?.(cid, limit) ?? null;
      }),
      newChat: mock(function(this: RawGemini) {
        if (mockOverrides?.newChat) {
          return mockOverrides.newChat();
        }
        return session;
      }),
      deleteChat: mock(async function(this: RawGemini, cid: string) {
        if (mockOverrides?.deleteChat) {
          await mockOverrides.deleteChat(cid);
        }
      }),
      models: mock(async () => mockOverrides?.models ?? null),
    };
    mockClientInstances.push(instance);
    return instance;
  };

  return {
    Gemini: mockGeminiFactory as unknown as GeminiClientDeps["Gemini"],
    AuthError: MockAuthError as unknown as GeminiClientDeps["AuthError"],
    UsageLimitExceeded: MockUsageLimitExceeded as unknown as GeminiClientDeps["UsageLimitExceeded"],
    TemporarilyBlocked: MockTemporarilyBlocked as unknown as GeminiClientDeps["TemporarilyBlocked"],
    ModelInvalid: MockModelInvalid as unknown as GeminiClientDeps["ModelInvalid"],
    APIError: MockAPIError as unknown as GeminiClientDeps["APIError"],
    GeminiError: MockGeminiError as unknown as GeminiClientDeps["GeminiError"],
  };
}

describe("GeminiClientService", () => {
  let logger: Logger;
  let cookieStorageService: CookieStorageService;

  beforeEach(async () => {
    setupTestConfig("gemini-client-wrapper");
    logger = new Logger("test");
    const storage = createMockCookieStorage();
    cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
  });

  afterEach(() => {
    teardownTestConfig();
  });

  describe("listChats", () => {
    test("maps cid to id and pinned to isPinned", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "chat-1", title: "First Chat", pinned: true, timestamp: 1700000000000 }),
          createMockChatRow({ cid: "chat-2", title: "Second Chat", pinned: false, timestamp: 1699000000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const chats = await service.listChats();

      expect(chats[0].id).toBe("chat-1");
      expect(chats[0].title).toBe("First Chat");
      expect(chats[0].isPinned).toBe(true);
      expect(chats[1].id).toBe("chat-2");
      expect(chats[1].isPinned).toBe(false);
    });

    test("applies search filter", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "1", title: "Python Help" }),
          createMockChatRow({ cid: "2", title: "JavaScript Help" }),
          createMockChatRow({ cid: "3", title: "Python Tips" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const chats = await service.listChats({ search: "python" });

      expect(chats).toHaveLength(2);
      expect(chats[0].title).toBe("Python Help");
      expect(chats[1].title).toBe("Python Tips");
    });

    test("applies limit and offset", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "1", title: "Chat 1", timestamp: 1700000000 }),
          createMockChatRow({ cid: "2", title: "Chat 2", timestamp: 1699000000 }),
          createMockChatRow({ cid: "3", title: "Chat 3", timestamp: 1698000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const chats = await service.listChats({ limit: 1, offset: 1 });

      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe("2");
    });

    test("sorts by timestamp descending", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "1", title: "Older", timestamp: 1000000000 }),
          createMockChatRow({ cid: "2", title: "Newer", timestamp: 2000000000 }),
          createMockChatRow({ cid: "3", title: "Middle", timestamp: 1500000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const chats = await service.listChats();

      expect(chats[0].title).toBe("Newer");
      expect(chats[1].title).toBe("Middle");
      expect(chats[2].title).toBe("Older");
    });

    test("converts timestamp from seconds to milliseconds", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "1", title: "Chat", timestamp: 1700000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const chats = await service.listChats();

      expect(chats[0].timestamp).toBe(1700000000000);
    });

    test("timestamp produces valid date (not epoch 1970)", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "1", title: "Chat", timestamp: 1700000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

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

      const d = installGeminiReverseMock({
        chats: [createMockChatRow({ cid: "1", title: "Profile Chat" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css, undefined, d);
      const profileService = service.forProfile("work");

      const chats = await profileService.listChats();

      expect(chats[0].profile).toBe("work");
    });

    test("throws when chats returns null", async () => {
      const d = installGeminiReverseMock({ chats: null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Gemini returned no data");
    });

    test("throws when chats returns undefined", async () => {
      const d = installGeminiReverseMock({ chats: undefined });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Gemini returned no data");
    });
  });

  describe("fetchChat", () => {
    test("flattens turns text correctly", async () => {
      const d = installGeminiReverseMock({
        readChat: (_cid: string) => [
          createMockChatTurn("user", "Hello"),
          createMockChatTurn("model", "Hi there!"),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const messages = await service.fetchChat("conv-123");

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
      expect(messages[1].role).toBe("model");
      expect(messages[1].content).toBe("Hi there!");
    });

    test("returns empty array when readChat returns null", async () => {
      const d = installGeminiReverseMock({ readChat: () => null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const messages = await service.fetchChat("nonexistent");

      expect(messages).toEqual([]);
    });

    test("saves rid/rcid from last model turn to ChatMetadataStorage", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const d: GeminiClientDeps = {
        Gemini: function() {
          return {
            cookies: { "__Secure-1PSID": "sid" },
            init: async () => {},
            chats: async () => [],
            readChat: async (_cid: string) => [
              createMockChatTurn("user", "Hello", "r_user1"),
              createMockChatTurn("model", "Hi there!", "r_model1", "rc_model1"),
            ],
            newChat: () => createMockSession(),
            deleteChat: async () => {},
            models: async () => [],
          };
        },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.fetchChat("conv-abc");

      const saved = chatMetadata.lookup("testprofile", "conv-abc");
      expect(saved).toEqual({ rid: "r_model1", rcid: "rc_model1", ctx: null });
    });

    test("does not save metadata when readChat returns empty array", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        "testprofile-empty": { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const d: GeminiClientDeps = {
        Gemini: function() {
          return {
            cookies: { "__Secure-1PSID": "sid" },
            init: async () => {},
            chats: async () => [],
            readChat: async () => [],
            newChat: () => createMockSession(),
            deleteChat: async () => {},
            models: async () => [],
          };
        },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile-empty", d, chatMetadata);

      await service.fetchChat("conv-empty");

      const saved = chatMetadata.lookup("testprofile-empty", "conv-empty");
      expect(saved).toBeNull();
    });
  });

  describe("sendMessage", () => {
    test("returns output.text", async () => {
      const d = installGeminiReverseMock({
        newChat: () => createMockSession("conv-1", "model response"),
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const result = await service.sendMessage("conv-1", "hello");

      expect(result).toBe("model response");
    });

    test("sendMessage restores chat.metadata from storage when prior metadata exists", async () => {
      let capturedNewChatMetadata: (string | null)[] | null = null;
      let _meta: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "existing-conv-xyz"; },
        set cid(v: string) {},
        get metadata() { return _meta; },
        set metadata(v: (string | null)[]) {
          if (!Array.isArray(v)) return;
          _meta = [...v];
          capturedNewChatMetadata = [...v];
        },
        generateContent: async function(_opts: { prompt: string }) {
          return { text: { toString: () => "model response" }, metadata: [..._meta] };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async () => null,
        newChat: (opts?: { metadata?: (string | null)[] }) => {
          if (opts?.metadata) {
            capturedNewChatMetadata = [...opts.metadata];
            _meta = [...opts.metadata];
          }
          return mockSession;
        },
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);
      chatMetadata.save("testprofile", "existing-conv-xyz", { rid: "rid-xyz", rcid: "rcid-xyz", ctx: null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.sendMessage("existing-conv-xyz", "hello");

      expect(capturedNewChatMetadata).toEqual(["existing-conv-xyz", "rid-xyz", "rcid-xyz", null, null, null, null, null, null, ""]);
    });

    test("sendMessage uses session.metadata setter (not newChat opts) to restore prior metadata", async () => {
      let newChatCalledWithMetadata = false;
      let setterCalledWith: (string | null)[] | null = null;
      let _meta: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "existing-conv-xyz"; },
        set cid(v: string) {},
        get metadata() { return _meta; },
        set metadata(v: (string | null)[]) {
          if (!Array.isArray(v)) return;
          _meta = [...v];
          setterCalledWith = [...v];
        },
        generateContent: async function(_opts: { prompt: string }) {
          return { text: { toString: () => "model response" }, metadata: [..._meta] };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async () => null,
        newChat: (opts?: { metadata?: (string | null)[] }) => {
          if (opts?.metadata) {
            newChatCalledWithMetadata = true;
          }
          return mockSession;
        },
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);
      chatMetadata.save("testprofile", "existing-conv-xyz", { rid: "rid-xyz", rcid: "rcid-xyz", ctx: null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.sendMessage("existing-conv-xyz", "hello");

      expect(newChatCalledWithMetadata).toBe(false);
      expect(setterCalledWith).toEqual(["existing-conv-xyz", "rid-xyz", "rcid-xyz", null, null, null, null, null, null, ""]);
    });

    test.skip("sendMessage falls back to cid-only when no prior metadata exists", async () => {
      let capturedNewChatMetadata: (string | null)[] | null = null;
      let _meta: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "existing-conv-xyz"; },
        set cid(v: string) {},
        get metadata() { return _meta; },
        set metadata(v: (string | null)[]) {
          if (!Array.isArray(v)) return;
          _meta = [...v];
        },
        generateContent: async function(_opts: { prompt: string }) {
          return { text: { toString: () => "model response" }, metadata: [..._meta] };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async () => null,
        newChat: (opts?: { metadata?: (string | null)[] }) => {
          if (opts?.metadata) {
            capturedNewChatMetadata = [...opts.metadata];
            _meta = [...opts.metadata];
          }
          return mockSession;
        },
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.sendMessage("existing-conv-xyz", "hello");

      expect(capturedNewChatMetadata).toEqual(["existing-conv-xyz", "", "", null, null, null, null, null, null, ""]);
    });

    test("sendMessage captures new rid/rcid into storage after a successful turn", async () => {
      const responseMetadata: (string | null)[] = ["existing-conv-xyz", "new-rid", "new-rcid", null, null, null, null, null, null, ""];
      let _meta: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "existing-conv-xyz"; },
        set cid(v: string) {},
        get metadata() { return _meta; },
        set metadata(v: (string | null)[]) {
          if (!Array.isArray(v)) return;
          _meta = [...v];
        },
        generateContent: async function(_opts: { prompt: string }) {
          return { text: { toString: () => "model response" }, metadata: responseMetadata };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async () => null,
        newChat: (opts?: { metadata?: (string | null)[] }) => {
          if (opts?.metadata) {
            _meta = [...opts.metadata];
          }
          return mockSession;
        },
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.sendMessage("existing-conv-xyz", "hello");

      const saved = chatMetadata.lookup("testprofile", "existing-conv-xyz");
      expect(saved).toEqual({ rid: "new-rid", rcid: "new-rcid", ctx: null });
    });

    test("sendMessage uses metadata warmed by fetchChat", async () => {
      let sessionMetadataUsed: (string | null)[] | null = null;
      let _meta: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "conv-xyz"; },
        set cid(_v: string) {},
        get metadata() { return _meta; },
        set metadata(v: (string | null)[]) {
          if (!Array.isArray(v)) return;
          _meta = [...v];
        },
        generateContent: async function(_opts: { prompt: string }) {
          sessionMetadataUsed = [...this.metadata];
          return { text: { toString: () => "model response" }, cid: "conv-xyz" };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async (_cid: string) => [
          createMockChatTurn("user", "Hello", "r_u1"),
          createMockChatTurn("model", "Hi!", "r_m1", "rc_m1"),
        ],
        newChat: () => mockSession,
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.fetchChat("conv-xyz");
      await service.sendMessage("conv-xyz", "continue this chat");

      expect(sessionMetadataUsed).toEqual(["conv-xyz", "r_m1", "rc_m1", null, null, null, null, null, null, ""]);
    });
  });

  describe("startNewChat", () => {
    test("returns output.text and session.cid", async () => {
      const d = installGeminiReverseMock({});

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const result = await service.startNewChat("Hello Gemini");

      expect(result.response).toBe("response text");
      expect(result.conversationId).toBe("new-cid");
    });

    test("startNewChat persists metadata for the new cid", async () => {
      const responseMetadata: (string | null)[] = ["generated-cid", "rid-a", "rcid-a", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "generated-cid"; },
        set cid(v: string) {},
        get metadata() { return ["", "", "", null, null, null, null, null, null, ""]; },
        set metadata(_v: (string | null)[]) {},
        generateContent: async function(_opts: { prompt: string }) {
          return { text: { toString: () => "model response" }, cid: "generated-cid", metadata: responseMetadata };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async () => null,
        newChat: () => mockSession,
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      const result = await service.startNewChat("Hello Gemini");

      expect(result.conversationId).toBe("generated-cid");
      const saved = chatMetadata.lookup("testprofile", "generated-cid");
      expect(saved).toEqual({ rid: "rid-a", rcid: "rcid-a", ctx: null });
    });

    test.skip("startNewChat does NOT persist when the mock response has empty rid/rcid", async () => {
      const responseMetadata: (string | null)[] = ["generated-cid", "", "", null, null, null, null, null, null, ""];

      const mockSession: RawChatSession = {
        get cid() { return "generated-cid"; },
        set cid(v: string) {},
        get metadata() { return ["", "", "", null, null, null, null, null, null, ""]; },
        set metadata(_v: (string | null)[]) {},
        generateContent: async function(_opts: { prompt: string }) {
          return { text: { toString: () => "model response" }, cid: "generated-cid", metadata: responseMetadata };
        },
      };

      const mockClient = {
        cookies: { "__Secure-1PSID": "sid" },
        init: async () => {},
        chats: async () => [],
        readChat: async () => null,
        newChat: () => mockSession,
        deleteChat: async () => {},
        models: async () => [],
      };

      const d: GeminiClientDeps = {
        Gemini: function() { return mockClient; },
        AuthError: MockAuthError,
        GeminiError: MockGeminiError,
        UsageLimitExceeded: MockUsageLimitExceeded,
        TemporarilyBlocked: MockTemporarilyBlocked,
        ModelInvalid: MockModelInvalid,
        APIError: MockAPIError,
      };

      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        testprofile: { secure_1psid: "sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });
      const chatMetadata = new ChatMetadataStorage(logger);

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, "testprofile", d, chatMetadata);

      await service.startNewChat("Hello Gemini");

      const saved = chatMetadata.lookup("testprofile", "generated-cid");
      expect(saved).toBeNull();
    });
  });

  describe("deleteChat", () => {
    test("calls client.deleteChat with cid", async () => {
      let deletedCid: string | null = null;
      const d = installGeminiReverseMock({
        deleteChat: async (cid: string) => {
          deletedCid = cid;
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await service.deleteChat("conv-to-delete");

      expect(deletedCid).toBe("conv-to-delete");
    });
  });

  describe("listModels", () => {
    test("returns model_name when present", async () => {
      const d = installGeminiReverseMock({
        models: [
          createMockAvailableModel({ model_id: "gemini-2.5", model_name: "Gemini 2.5", display_name: "Gemini 2.5 Flash" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const models = await service.listModels();

      expect(models).toEqual(["Gemini 2.5"]);
    });

    test("falls back to display_name when model_name is missing", async () => {
      const d = installGeminiReverseMock({
        models: [
          createMockAvailableModel({ model_id: "gemini-2.5", model_name: "", display_name: "Gemini 2.5 Flash" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const models = await service.listModels();

      expect(models).toEqual(["Gemini 2.5 Flash"]);
    });

    test("falls back to model_id when model_name and display_name are missing", async () => {
      const d = installGeminiReverseMock({
        models: [
          createMockAvailableModel({ model_id: "gemini-ultra", model_name: "", display_name: "" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const models = await service.listModels();

      expect(models).toEqual(["gemini-ultra"]);
    });

    test("returns empty array when models returns null", async () => {
      const d = installGeminiReverseMock({ models: null });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const models = await service.listModels();

      expect(models).toEqual([]);
    });
  });

  describe("error translations", () => {
    test("AuthError -> AuthenticationError", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockAuthError("auth failure");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Session expired or invalid");
    });

    test("ECONNABORTED -> GeminiAPIError timeout", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          const e = new Error("request timeout") as Error & { code?: string };
          e.code = "ECONNABORTED";
          throw e;
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Request to Gemini timed out");
    });

    test("APIError with stalled timeout message -> GeminiAPIError timeout", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockAPIError("Response stalled (zombie stream).");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Request to Gemini timed out");
    });

    test("UsageLimitExceeded -> GeminiAPIError", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockUsageLimitExceeded("usage exceeded");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Gemini usage limit reached");
    });

    test("TemporarilyBlocked -> GeminiAPIError", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockTemporarilyBlocked("blocked");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Temporarily blocked by Gemini");
    });

    test("ModelInvalid -> GeminiAPIError", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockModelInvalid("model invalid");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Model is invalid or unavailable");
    });

    test("APIError -> GeminiAPIError", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockAPIError("api error occurred");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("api error occurred");
    });

    test("GeminiError -> GeminiAPIError", async () => {
      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockGeminiError("generic gemini error");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("generic gemini error");
    });
  });

  describe("forProfile", () => {
    test("creates a brand-new Gemini instance", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: "work-ts" },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({ chats: [createMockChatRow({ cid: "1", title: "Work Chat" })] });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css, undefined, d);
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

      const d = installGeminiReverseMock({
        initImplementation: (client) => {
          receivedSid = (client as unknown as { cookies?: Record<string, string> }).cookies?.["__Secure-1PSID"] ?? "";
        },
        chats: [createMockChatRow({ cid: "work-1", title: "Work Chat" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css, undefined, d);

      const profileService = service.forProfile("work");
      await profileService.listChats();

      expect(receivedSid).toBe("work-sid");
    });
  });

  describe("profileHasConversation", () => {
    test("returns true when conversation exists in profile", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({
        chats: [createMockChatRow({ cid: "abc-123", title: "My Chat" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css, undefined, d);

      const result = await service.profileHasConversation("work", "abc-123");

      expect(result).toBe(true);
    });

    test("returns false when conversation does not exist in profile", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        personal: { secure_1psid: "personal-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({
        chats: [createMockChatRow({ cid: "other-456", title: "Other Chat" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css, undefined, d);

      const result = await service.profileHasConversation("personal", "abc-123");

      expect(result).toBe(false);
    });

    test("throws when listChats fails", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({
        chatsImplementation: () => {
          throw new MockAuthError("auth failure");
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css, undefined, d);

      await expect(service.profileHasConversation("work", "abc-123")).rejects.toThrow("Session expired or invalid");
    });

    test("passes limit:1 to listChats for targeted lookup", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      let capturedOptions: { limit?: number; offset?: number; search?: string } | undefined;
      const d = installGeminiReverseMock({
        chats: [createMockChatRow({ cid: "abc-123" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const originalListChats = GeminiClientService.prototype.listChats;
      GeminiClientService.prototype.listChats = function(options: { limit?: number }) {
        capturedOptions = options;
        return originalListChats.call(this, options);
      };

      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css, undefined, d);

      await service.profileHasConversation("work", "abc-123");

      GeminiClientService.prototype.listChats = originalListChats;
      expect(capturedOptions?.limit).toBe(1);
    });

    test("does not mutate the calling instance's cookie config", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: "work-ts" },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({
        chats: [createMockChatRow({ cid: "abc-123" })],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css, "main", d);
      const authBefore = service.isAuthenticated();

      await service.profileHasConversation("work", "abc-123");

      const authAfter = service.isAuthenticated();
      expect(authBefore).toBe(authAfter);
    });

    test("returns true for a non-newest conversation when profile has multiple chats (limit:1 bug)", async () => {
      const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
        work: { secure_1psid: "work-sid", secure_1psidts: null },
      };
      const storage = createMockCookieStorage(profileCookies);
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "newest", title: "Newest", timestamp: 2000000000 }),
          createMockChatRow({ cid: "older-target", title: "Older Target", timestamp: 1000000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, css, undefined, d);

      const result = await service.profileHasConversation("work", "older-target");

      expect(result).toBe(true);
    });
  });

  describe("init() idempotency", () => {
    test("calls client.init exactly once even when called multiple times", async () => {
      let initCallCount = 0;
      const d = installGeminiReverseMock({
        initImplementation: () => {
          initCallCount++;
        },
        chats: [createMockChatRow()],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await service.listChats();
      await service.listChats();
      await service.listChats();

      expect(initCallCount).toBe(1);
    });
  });

  describe("empty-cookies factory case", () => {
    test("init resolves but listChats throws when SDK returns null for empty-cookie client", async () => {
      const d = installGeminiReverseMock({});

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "" }, logger, undefined, undefined, d);

      await expect(service.listChats()).rejects.toThrow("Gemini returned no data");
    });
  });

  describe("silent-regression guards", () => {
    test("pinned: true maps to isPinned: true", async () => {
      const d = installGeminiReverseMock({
        chats: [
          createMockChatRow({ cid: "pinned-chat", title: "Pinned", pinned: true, timestamp: 1000000000 }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const chats = await service.listChats();

      expect(chats[0].isPinned).toBe(true);
    });

    test("models() prefers model_name over display_name", async () => {
      const d = installGeminiReverseMock({
        models: [
          createMockAvailableModel({ model_id: "gemini-3-pro", model_name: "gemini-3-pro", display_name: "Basic Pro" }),
        ],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      const models = await service.listModels();

      expect(models).toEqual(["gemini-3-pro"]);
    });

    test("fetchChat calls readChat with no explicit limit (upstream default of 10)", async () => {
      let capturedLimit: number | undefined;
      const d = installGeminiReverseMock({
        readChat: (_cid: string, limit?: number) => {
          capturedLimit = limit;
          return [createMockChatTurn("user", "hi")];
        },
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService({ secure1psid: "testsid" }, logger, undefined, undefined, d);

      await service.fetchChat("conv-1");

      expect(capturedLimit).toBeUndefined();
    });


  });
});

describe("persistRefreshedCookies", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger("test");
  });

  test("persists refreshed __Secure-1PSID with metadata preserved and original expires preserved", async () => {
    const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
      work: { secure_1psid: "work-sid", secure_1psidts: "work-ts" },
    };
    const storage = createMockCookieStorage(profileCookies);
    const saveCalls: { name: string; cookies: Cookie[] }[] = [];
    storage.save = mock((name: string, cookies: Cookie[]) => {
      saveCalls.push({ name, cookies });
    }) as CookieStorage["save"];
    const css = new CookieStorageService({ cookieStorage: storage, logger });

    let originalExpires: number | undefined;
    const initialCookies = storage.load("work");
    const psidCookie = initialCookies.find((c) => c.name === "__Secure-1PSID");
    if (psidCookie) {
      originalExpires = psidCookie.expires;
    }

    const d = installGeminiReverseMock({
      initImplementation: (client: RawGemini) => {
        (client as unknown as { cookies: Record<string, string> }).cookies["__Secure-1PSID"] = "refreshed-sid";
      },
      chats: [createMockChatRow({ cid: "1", title: "Chat" })],
    });

    const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
    const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css, undefined, d);
    const profileService = service.forProfile("work");

    await profileService.listChats();

    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].name).toBe("work");
    const psid = saveCalls[0].cookies.find((c) => c.name === "__Secure-1PSID")!;
    expect(psid.value).toBe("refreshed-sid");
    expect(psid.domain).toBe(".google.com");
    expect(psid.path).toBe("/");
    expect(psid.httpOnly).toBe(true);
    expect(psid.secure).toBe(true);
    expect(psid.sameSite).toBe("Lax");
    expect(originalExpires).toBeDefined();
    expect(psid.expires).toBe(originalExpires);
    const ts = saveCalls[0].cookies.find((c) => c.name === "__Secure-1PSIDTS")!;
    expect(ts.value).toBe("work-ts");

    await profileService.listChats();
    expect(saveCalls).toHaveLength(1);
  });

  test("does not save when tracked cookie values are unchanged", async () => {
    const profileCookies: Record<string, { secure_1psid: string; secure_1psidts: string | null }> = {
      work: { secure_1psid: "work-sid", secure_1psidts: "work-ts" },
    };
    const storage = createMockCookieStorage(profileCookies);
    const saveCalls: Cookie[][] = [];
    storage.save = mock((_name: string, cookies: Cookie[]) => {
      saveCalls.push(cookies);
    }) as CookieStorage["save"];
    const css = new CookieStorageService({ cookieStorage: storage, logger });

    const d = installGeminiReverseMock({ chats: [createMockChatRow()] });
    const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
    const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css, undefined, d);
    const profileService = service.forProfile("work");

    await profileService.listChats();

    expect(saveCalls).toHaveLength(0);
  });

  test("skips persistence when the instance has no profileName", async () => {
    const storage = createMockCookieStorage({});
    const saveCalls: Cookie[][] = [];
    storage.save = mock((_name: string, cookies: Cookie[]) => {
      saveCalls.push(cookies);
    }) as CookieStorage["save"];
    const css = new CookieStorageService({ cookieStorage: storage, logger });

    const d = installGeminiReverseMock({
      initImplementation: (client: RawGemini) => {
        (client as unknown as { cookies: Record<string, string> }).cookies["__Secure-1PSID"] = "refreshed-sid";
      },
      chats: [createMockChatRow()],
    });

    const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
    const service = new GeminiClientService({ secure1psid: "sid" }, logger, css, undefined, d);

    await service.listChats();

    expect(saveCalls).toHaveLength(0);
  });

  test("operation still succeeds when persistence throws", async () => {
    const storage = createMockCookieStorage({
      work: { secure_1psid: "work-sid", secure_1psidts: "work-ts" },
    });
    storage.save = mock(() => {
      throw new Error("disk full");
    }) as CookieStorage["save"];
    const css = new CookieStorageService({ cookieStorage: storage, logger });

    const d = installGeminiReverseMock({
      initImplementation: (client: RawGemini) => {
        (client as unknown as { cookies: Record<string, string> }).cookies["__Secure-1PSID"] = "refreshed-sid";
      },
      chats: [createMockChatRow({ cid: "1", title: "Chat" })],
    });

    const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
    const service = new GeminiClientService({ secure1psid: "main-sid" }, logger, css, undefined, d);
    const profileService = service.forProfile("work");

    const chats = await profileService.listChats();

    expect(chats).toHaveLength(1);
  });

  describe("persistRefreshedCookies merge by (name, baselineValue)", () => {
    test("SDK rotation overwrites only the matching baseline entry, not cross-domain duplicates", async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const multiDomainCookies: Cookie[] = [
        { name: "__Secure-1PSID", value: "yt-psid", domain: ".youtube.com", path: "/", expires: farFuture, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "__Secure-1PSID", value: "g-psid", domain: ".google.com", path: "/", expires: farFuture, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "__Secure-1PSIDTS", value: "yt-psidts", domain: ".youtube.com", path: "/", expires: farFuture, httpOnly: true, secure: true, sameSite: "Lax" },
        { name: "__Secure-1PSIDTS", value: "g-psidts", domain: ".google.com", path: "/", expires: farFuture, httpOnly: true, secure: true, sameSite: "Lax" },
      ];
      let savedCookies: Cookie[] | undefined;
      const storage: CookieStorage = {
        save: (_profile, cookies) => {
          savedCookies = cookies;
        },
        load: () => multiDomainCookies,
        delete: () => {},
        list: () => ["default"],
      };
      const css = new CookieStorageService({ cookieStorage: storage, logger });

      const d = installGeminiReverseMock({
        initImplementation: (client: RawGemini) => {
          const cookies = (client as unknown as { cookies: Record<string, string> }).cookies;
          cookies["__Secure-1PSID"] = "NEW-g-psid";
          cookies["__Secure-1PSIDTS"] = "NEW-g-psidts";
        },
        chats: [createMockChatRow()],
      });

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService(
        { secure1psid: "g-psid", secure1psidts: "g-psidts" },
        logger,
        css,
        "default",
        d,
      );

      await service.listChats();

      expect(savedCookies).toBeDefined();
      expect(savedCookies?.find((c) => c.name === "__Secure-1PSID" && c.domain === ".google.com")?.value).toBe("NEW-g-psid");
      expect(savedCookies?.find((c) => c.name === "__Secure-1PSID" && c.domain === ".youtube.com")?.value).toBe("yt-psid");
      expect(savedCookies?.find((c) => c.name === "__Secure-1PSIDTS" && c.domain === ".google.com")?.value).toBe("NEW-g-psidts");
      expect(savedCookies?.find((c) => c.name === "__Secure-1PSIDTS" && c.domain === ".youtube.com")?.value).toBe("yt-psidts");
    });
  });
});