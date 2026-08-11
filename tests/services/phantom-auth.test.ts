import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
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
}

function gimme(
  modelsImpl: ReturnType<typeof mock>,
): GimmeClient {
  return {
    _modelsSpy: modelsImpl,
    models: modelsImpl as unknown as IGeminiClientService["models"],
    async listChats() { return []; },
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
    test("probe removed: models() is NOT called, cookies returned as-is", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsSpy = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsSpy);

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
      expect(modelsSpy).toHaveBeenCalledTimes(0);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("dormancy-resilient: cookies returned without probing server", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeActiveCookies());

      const modelsSpy = mock(async () => { throw new Error("auth error"); });
      const geminiClient = gimme(modelsSpy);

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
      expect(modelsSpy).toHaveBeenCalledTimes(0);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });
  });

  describe("Smoke harness — probe removed, no spurious refresh", () => {
    test("multi-domain cookies + models() NOT called, no spurious silentRefresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeMultiDomainCookies());

      const modelsSpy = mock(async () => { throw new Error("auth error"); });
      const geminiClient = gimme(modelsSpy);

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

      expect(modelsSpy).toHaveBeenCalledTimes(0);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("multi-domain cookies preserved intact without spurious refresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeMultiDomainCookies());

      const modelsSpy = mock(async () => { throw new Error("auth error"); });
      const geminiClient = gimme(modelsSpy);

      const silentRefresh = mock(async (_profileName: string) => false);

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
      });

      await mgr.ensureAuthenticated("default");

      const postAuth = storage.load("default");
      const googlePsidts = postAuth.find((c) => c.name === "__Secure-1PSIDTS" && c.domain === ".google.com");
      const ytPsidts = postAuth.find((c) => c.name === "__Secure-1PSIDTS" && c.domain === ".youtube.com");

      expect(postAuth.length).toBe(4);
      expect(googlePsidts?.value).toBe("g-psidts");
      expect(ytPsidts?.value).toBe("yt-psidts");
      expect(modelsSpy).toHaveBeenCalledTimes(0);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });
  });
});
