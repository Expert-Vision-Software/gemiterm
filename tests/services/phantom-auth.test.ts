import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { AuthenticationError } from "../../src/core/errors.ts";
import type { Cookie, ChatInfo } from "../../src/core/types.ts";
import type { IGeminiClientService } from "../../src/core/command-handlers.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-phantom-auth");
const logger = new Logger("test");

function makeActiveCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "active-psid",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSIDTS",
      value: "active-psidts",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ];
}

function makeRefreshedCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "refreshed-psid",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSIDTS",
      value: "refreshed-psidts",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ];
}

function makeMultiDomainCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "yt-psid",
      domain: ".youtube.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSID",
      value: "g-psid",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSIDTS",
      value: "yt-psidts",
      domain: ".youtube.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSIDTS",
      value: "g-psidts",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ];
}

interface GimmeClient extends IGeminiClientService {
  _listChatsSpy: ReturnType<typeof mock>;
}

function gimme(listChatsFn: (opts?: { limit?: number; offset?: number; search?: string }) => Promise<ChatInfo[]>): GimmeClient {
  const _listChatsSpy = mock(listChatsFn);
  return {
    _listChatsSpy,
    listChats: _listChatsSpy as unknown as IGeminiClientService["listChats"],
    async deleteChat() {},
    async sendMessage() { return ""; },
    async startNewChat() { return { response: "", conversationId: "" }; },
    async profileHasConversation() { return false; },
    forProfile() { return this as unknown as IGeminiClientService; },
  };
}

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GEMITERM_CONFIG_DIR;
});

describe("phantom-auth regression suite", () => {
  describe("ProfileAuthManager server-side probe", () => {
    test("locally-valid cookies + server returns [] triggers silent refresh, not silent success", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());
      writeFileSync(join(TEST_DIR, "profiles", "default", "profile-has-chats"), "");

      const listChatsFn = mock(async (_opts?: { limit?: number }) => [] as ChatInfo[]);
      const geminiClient = gimme(listChatsFn as unknown as (opts?: { limit?: number; offset?: number; search?: string }) => Promise<ChatInfo[]>);

      const silentRefresh = mock(async (_profileName: string) => {
        storage.save("default", makeRefreshedCookies());
        return true;
      });

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("refreshed-psid");
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("listChats([]) followed by a failed silent refresh surfaces AuthenticationError", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());
      writeFileSync(join(TEST_DIR, "profiles", "default", "profile-has-chats"), "");

      const listChatsFn = mock(async (_opts?: { limit?: number }) => [] as ChatInfo[]);
      const geminiClient = gimme(listChatsFn as unknown as (opts?: { limit?: number; offset?: number; search?: string }) => Promise<ChatInfo[]>);

      const silentRefresh = mock(async (_profileName: string) => false);

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
      });

      const err = await mgr.ensureAuthenticated("default").catch((e) => e);
      expect(err).toBeInstanceOf(AuthenticationError);
      expect((err as Error).message).toMatch(/No valid session|re-authenticate/i);
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("listChats(non-empty) means session is valid; no silent refresh spent", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const listChatsFn = mock(async (_opts?: { limit?: number }) => [
        { id: "c1", title: "t", isPinned: false, timestamp: Date.now() },
      ] as ChatInfo[]);
      const geminiClient = gimme(listChatsFn as unknown as (opts?: { limit?: number; offset?: number; search?: string }) => Promise<ChatInfo[]>);

      const silentRefresh = mock(async (_profileName: string) => true);

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(cookies.secure_1psidts).toBe("active-psidts");
      expect(silentRefresh).toHaveBeenCalledTimes(0);
      expect(listChatsFn).toHaveBeenCalledTimes(1);
    });

    test("Probe budget — repeat ensureAuthenticated within TTL reuses the cached result", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const listChatsFn = mock(async (_opts?: { limit?: number }) => [
        { id: "c1", title: "t", isPinned: false, timestamp: Date.now() },
      ] as ChatInfo[]);
      const geminiClient = gimme(listChatsFn as unknown as (opts?: { limit?: number; offset?: number; search?: string }) => Promise<ChatInfo[]>);

      const silentRefresh = mock(async (_profileName: string) => true);

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
      });

      const r1 = await mgr.ensureAuthenticated("default");
      const r2 = await mgr.ensureAuthenticated("default");
      const r3 = await mgr.ensureAuthenticated("default");

      expect(listChatsFn).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
      expect(r2.secure_1psid).toBe(r1.secure_1psid);
      expect(r3.secure_1psid).toBe(r1.secure_1psid);
    });
  });

  describe("GeminiClientService.persistRefreshedCookies merge-by-(name, domain)", () => {
    test("SDK rotation overwrites only the matching domain entry", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeMultiDomainCookies());

      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });

      let capturedInstance: Record<string, unknown> | null = null;

      const MockAuthError = class extends Error { name = "AuthError"; };
      const MockAPIError = class extends Error { name = "APIError"; };
      const MockGeminiError = class extends Error { name = "GeminiError"; };
      const MockUsageLimitExceeded = class extends MockGeminiError { name = "UsageLimitExceeded"; };
      const MockModelInvalid = class extends MockGeminiError { name = "ModelInvalid"; };
      const MockTemporarilyBlocked = class extends MockGeminiError { name = "TemporarilyBlocked"; };

      const MockGemini = function(this: Record<string, unknown>, config?: { secure_1psid?: string }) {
        const cookies: Record<string, string> = {};
        if (config?.secure_1psid) {
          cookies["__Secure-1PSID"] = config.secure_1psid;
        }
        this.cookies = cookies;
        this.init = mock(async function(this: Record<string, unknown>) {
          (this.cookies as Record<string, string>)["__Secure-1PSID"] = "NEW-g-psid";
        });
        this.chats = mock(async () => [] as RawChatRow[]);
        this.readChat = mock(async () => [] as RawChatTurn[]);
        this.newChat = mock(() => ({
          cid: "c1",
          generateContent: mock(async () => ({ text: { toString: () => "ok" } })),
        }));
        this.deleteChat = mock(async () => {});
        this.models = mock(async () => []);
        capturedInstance = this;
        return this;
      };

      const mockDeps = {
        Gemini: MockGemini as unknown as new (...args: unknown[]) => unknown,
        AuthError: MockAuthError as unknown as new (...args: unknown[]) => unknown,
        APIError: MockAPIError as unknown as new (...args: unknown[]) => unknown,
        GeminiError: MockGeminiError as unknown as new (...args: unknown[]) => unknown,
        UsageLimitExceeded: MockUsageLimitExceeded as unknown as new (...args: unknown[]) => unknown,
        ModelInvalid: MockModelInvalid as unknown as new (...args: unknown[]) => unknown,
        TemporarilyBlocked: MockTemporarilyBlocked as unknown as new (...args: unknown[]) => unknown,
      };

      const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
      const service = new GeminiClientService(
        { secure1psid: "g-psid", secure1psidts: "g-psidts" },
        logger,
        cookieStorageService,
        "default",
        mockDeps,
      );

      await service.listChats();

      const stored = storage.load("default");
      const googleCookie = stored.find((c) => c.name === "__Secure-1PSID" && c.domain === ".google.com");
      const youtubeCookie = stored.find((c) => c.name === "__Secure-1PSID" && c.domain === ".youtube.com");

      expect(googleCookie?.value).toBe("NEW-g-psid");
      expect(youtubeCookie?.value).toBe("yt-psid");
    });
  });
});

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
