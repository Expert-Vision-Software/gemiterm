import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { AuthenticationError } from "../../src/core/errors.ts";
import type { Cookie } from "../../src/core/types.ts";
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

function makeDroppedCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "yt-psid-refreshed",
      domain: ".youtube.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSIDTS",
      value: "yt-psidts-refreshed",
      domain: ".youtube.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSID",
      value: "g-psid-refreshed",
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
  _modelsSpy: ReturnType<typeof mock>;
  _listChatsSpy: ReturnType<typeof mock>;
}

function gimme(
  modelsImpl: ReturnType<typeof mock>,
  listChatsImpl: ReturnType<typeof mock> = mock(async () => [] as { cid: string; title: string }[]),
): GimmeClient {
  return {
    _modelsSpy: modelsImpl,
    _listChatsSpy: listChatsImpl,
    models: modelsImpl as unknown as IGeminiClientService["models"],
    listChats: listChatsImpl as unknown as IGeminiClientService["listChats"],
    async deleteChat() {},
    async sendMessage() { return ""; },
    async startNewChat() { return { response: "", conversationId: "" }; },
    async profileHasConversation() { return false; },
    async forProfile() { return this as unknown as IGeminiClientService; },
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
    test("models() throws triggers silent refresh, not silent success", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const geminiClient = gimme(mock(async () => { throw new Error("auth error"); }));

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

    test("models() throws followed by a failed silent refresh continues (dormancy-resilient)", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const geminiClient = gimme(mock(async () => { throw new Error("auth error"); }));

      const silentRefresh = mock(async (_profileName: string) => false);

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
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("models() succeeds still rotates (stale 1PSIDTS detection)", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: true, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(cookies.secure_1psidts).toBe("active-psidts");
      expect(rotateCookies).toHaveBeenCalledTimes(1);
      expect(rotateCookies).toHaveBeenCalledWith("default");
      expect(silentRefresh).toHaveBeenCalledTimes(0);
      expect(modelsFn).toHaveBeenCalledTimes(1);
    });

    test("rotateCookies reports session-invalid (401/403) => phantom detection + targeted L2 recovers", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string, _opts?: unknown) => true);
      const rotateCookies = mock(async (_profileName: string) => ({
        rotated: false,
        attempted: false,
        sessionInvalid: true,
      }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("rotateCookies declined (200, no fresh PSIDTS) does NOT escalate to L2 silentRefresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const listChatsFn = mock(async () => [{ cid: "c1", title: "existing chat" }]);
      const geminiClient = gimme(modelsFn, listChatsFn);

      const silentRefresh = mock(async (_profileName: string) => false);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("L1 declined + phantom-auth detected (models ok, listChats empty) => targeted silentRefresh recovers", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const listChatsFn = mock(async () => [] as { cid: string; title: string }[]);
      const geminiClient = gimme(modelsFn, listChatsFn);

      const silentRefresh = mock(async (_profileName: string, _opts?: unknown) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(listChatsFn).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("L1 declined + phantom-auth detected + targeted silentRefresh returns false => AuthenticationError", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const listChatsFn = mock(async () => [] as { cid: string; title: string }[]);
      const geminiClient = gimme(modelsFn, listChatsFn);

      const silentRefresh = mock(async (_profileName: string, _opts?: unknown) => false);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const err = await mgr.ensureAuthenticated("default").catch((e) => e);

      expect(err).toBeInstanceOf(AuthenticationError);
      expect((err as Error).message).toMatch(/phantom|re-authenticate|login/i);
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("L1 declined + listChats returns >=1 (not phantom) => no recovery, no throw", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const listChatsFn = mock(async () => [{ cid: "c1", title: "real chat" }]);
      const geminiClient = gimme(modelsFn, listChatsFn);

      const silentRefresh = mock(async (_profileName: string, _opts?: unknown) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(listChatsFn).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("L1 declined + listChats rejects => no recovery (treated as non-phantom)", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const listChatsFn = mock(async () => { throw new Error("listChats failed"); });
      const geminiClient = gimme(modelsFn, listChatsFn);

      const silentRefresh = mock(async (_profileName: string, _opts?: unknown) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("active-psid");
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("Probe budget — repeat ensureAuthenticated within TTL reuses the cached result", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"] as string[]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: true, attempted: true }));

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const r1 = await mgr.ensureAuthenticated("default");
      const r2 = await mgr.ensureAuthenticated("default");
      const r3 = await mgr.ensureAuthenticated("default");

      expect(modelsFn).toHaveBeenCalledTimes(1);
      expect(rotateCookies).toHaveBeenCalledTimes(3);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
      expect(r2.secure_1psid).toBe(r1.secure_1psid);
      expect(r3.secure_1psid).toBe(r1.secure_1psid);
    });
  });

  describe("Smoke harness — B1+B2 (false-positive probe) + B3 (jar corruption)", () => {
    test("B1+B2 — multi-domain cookies + models() throws triggers silentRefresh (false positive)", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeMultiDomainCookies());

      const geminiClient = gimme(mock(async () => { throw new Error("auth error"); }));

      const silentRefresh = mock(async (_profileName: string) => true);

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
      });

      await mgr.ensureAuthenticated("default");

      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("B3 — silentRefresh 4→3 cookie drop: .google.com __Secure-1PSIDTS evicted", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeMultiDomainCookies());

      const geminiClient = gimme(mock(async () => { throw new Error("auth error"); }));

      const droppedCookies = makeDroppedCookies();
      let savedDropCount = 0;
      const silentRefresh = mock(async (_profileName: string) => {
        storage.save("default", droppedCookies);
        savedDropCount = storage.load("default").length;
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

      await mgr.ensureAuthenticated("default");

      const postRefresh = storage.load("default");
      const googlePsidts = postRefresh.find((c) => c.name === "__Secure-1PSIDTS" && c.domain === ".google.com");

      expect(savedDropCount).toBe(3);
      expect(postRefresh.length).toBe(3);
      expect(googlePsidts).toBeUndefined();
      expect(silentRefresh).toHaveBeenCalledTimes(1);
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
