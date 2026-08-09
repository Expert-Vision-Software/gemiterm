import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { ProfileManager as ProfileManagerType } from "../../src/infrastructure/storage.ts";
import type { IGeminiClientService } from "../../src/core/command-handlers.ts";
import type { RotateCookiesResult } from "../../src/services/cookie-rotation.ts";

/*
The 8 tests in `describe('findProfileForConversation')` previously asserted the BUGGY
'first active profile' behavior; they have been updated to assert the CORRECT
per-profile-lookup behavior. See `openspec/changes/command-spec-conformance/proposal.md`
for context.
*/

const TEST_DIR = join(tmpdir(), "gemiterm-test-profile-auth-manager");

const logger = new Logger("test");

function makeValidCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "test-psid-value",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "test-psidts-value",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function makeExpiredCookies(): Cookie[] {
  const past = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "expired-psid-value",
      domain: ".google.com",
      path: "/",
      expires: past,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "expired-psidts-value",
      domain: ".google.com",
      path: "/",
      expires: past,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function createManager(
  profileManager: ProfileManagerType,
  geminiClient?: IGeminiClientService,
  silentRefresh: (profileName: string) => Promise<boolean> = async () => false,
  rotateCookies: (profileName: string) => Promise<RotateCookiesResult> = async () => ({ rotated: false, attempted: false }),
): ProfileAuthManager {
  const cookieStorage = new CookieStorageService({
    cookieStorage: new CookieStorage(),
    logger,
  });
  return new ProfileAuthManager({
    profileManager,
    cookieStorageService: cookieStorage,
    logger,
    geminiClient: geminiClient ?? {
      async deleteChat() { return; },
      async sendMessage() { return ""; },
      async startNewChat() { return { response: "", conversationId: "" }; },
      async profileHasConversation() { return false; },
      async models() { return []; },
      async forProfile() { return this as unknown as IGeminiClientService; },
    },
    silentRefresh,
    rotateCookies,
  });
}

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GEMITERM_CONFIG_DIR;
});

describe("ProfileAuthManager", () => {
  describe("ensureAuthenticated", () => {
    test("returns cookies for a profile with valid session", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const mgr = createManager(manager);
      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(cookies.secure_1psidts).toBe("test-psidts-value");
    });

    test("throws AuthenticationError when no valid cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");

      const mgr = createManager(manager);

      await expect(mgr.ensureAuthenticated("default")).rejects.toThrow("No valid session");
    });

    test("continues (dormancy-resilient) with expired-but-present cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeExpiredCookies());

      const mgr = createManager(manager);

      const cookies = await mgr.ensureAuthenticated("default");
      expect(cookies.secure_1psid).toBeTruthy();
    });

    test("auto-extends session before throwing when silentRefresh succeeds", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeExpiredCookies());

      const silentRefresh = mock(async (_profileName: string) => {
        storage.save("default", makeValidCookies());
        return true;
      });

      const infoSpy = mock(() => {});
      const testLogger = new Logger("test");
      testLogger.info = infoSpy;

      const cookieStorage = new CookieStorageService({
        cookieStorage: storage,
        logger: testLogger,
      });

      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger: testLogger,
        geminiClient: {
          async deleteChat() { return; },
          async sendMessage() { return ""; },
          async startNewChat() { return { response: "", conversationId: "" }; },
          async profileHasConversation() { return false; },
          async models() { return []; },
          async forProfile() { return this as unknown as IGeminiClientService; },
        },
        silentRefresh,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(silentRefresh).toHaveBeenCalledWith("default");
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Session auto-refreshed for profile 'default'"),
      );
    });

    test("auto-extend failure continues (dormancy-resilient) when cookies exist", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeExpiredCookies());

      const silentRefresh = mock(async (_profileName: string) => false);

      const mgr = createManager(manager, undefined, silentRefresh);

      const cookies = await mgr.ensureAuthenticated("default");
      expect(cookies.secure_1psid).toBeTruthy();
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    describe("dormancy regression guard — must never reintroduce throw on stale sessions", () => {
      test("DO NOT THROW: expired cookies still on disk must resolve, not reject", async () => {
        const storage = new CookieStorage();
        const manager = new ProfileManager(storage);
        manager.create("default");
        storage.save("default", makeExpiredCookies());

        const mgr = createManager(manager);
        const result = await mgr.ensureAuthenticated("default");
        expect(result.secure_1psid).toBeTruthy();
      });

      test("DO NOT THROW: models() throws + silentRefresh fails must resolve", async () => {
        const storage = new CookieStorage();
        const manager = new ProfileManager(storage);
        manager.create("default");
        storage.save("default", makeValidCookies());

        const modelsFn = mock(async () => { throw new Error("network error"); });
        const geminiClient = {
          models: modelsFn as unknown as IGeminiClientService["models"],
          async forProfile() { return this as unknown as IGeminiClientService; },
          async deleteChat() {},
          async sendMessage() { return ""; },
          async startNewChat() { return { response: "", conversationId: "" }; },
          async profileHasConversation() { return false; },
        };
        const silentRefresh = mock(async () => false);

        const mgr = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh);
        const result = await mgr.ensureAuthenticated("default");
        expect(result.secure_1psid).toBe("test-psid-value");
      });

      test("DO NOT THROW: probe stale + silentRefresh fails must resolve", async () => {
        const storage = new CookieStorage();
        const manager = new ProfileManager(storage);
        manager.create("default");
        storage.save("default", makeValidCookies());

        const modelsFn = mock(async () => { throw new Error("network error"); });
        const geminiClient = {
          models: modelsFn as unknown as IGeminiClientService["models"],
          async forProfile() { return this as unknown as IGeminiClientService; },
          async deleteChat() {},
          async sendMessage() { return ""; },
          async startNewChat() { return { response: "", conversationId: "" }; },
          async profileHasConversation() { return false; },
        };
        const silentRefresh = mock(async () => false);

        const mgr = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh);
        const result = await mgr.ensureAuthenticated("default");
        expect(result.secure_1psid).toBe("test-psid-value");
        expect(silentRefresh).toHaveBeenCalledTimes(1);
      });
    });

    test("throws on invalid profile name", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const mgr = createManager(manager);

      await expect(mgr.ensureAuthenticated("bad name!")).rejects.toThrow("invalid characters");
    });

    test("uses default profile when none specified", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const markerDir = join(TEST_DIR, "config");
      mkdirSync(markerDir, { recursive: true });
      writeFileSync(join(markerDir, "default-profile"), "default", "utf-8");

      const mgr = createManager(manager);
      const cookies = await mgr.ensureAuthenticated();

      expect(cookies.secure_1psid).toBe("test-psid-value");
    });
  });

  describe("autoExtendSession", () => {
    test("returns true when cookies are already fresh without calling silentRefresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const silentRefresh = mock(async (_profileName: string) => true);

      const mgr = createManager(manager, undefined, silentRefresh);
      const result = await mgr.autoExtendSession("default");

      expect(result).toBe(true);
      expect(silentRefresh).not.toHaveBeenCalled();
    });

    test("calls silentRefresh when cookies are within the 1-hour grace window", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeExpiredCookies());

      const silentRefresh = mock(async (_profileName: string) => true);

      const mgr = createManager(manager, undefined, silentRefresh);
      const result = await mgr.autoExtendSession("default");

      expect(result).toBe(true);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("returns false when silentRefresh fails", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeExpiredCookies());

      const silentRefresh = mock(async (_profileName: string) => false);

      const mgr = createManager(manager, undefined, silentRefresh);
      const result = await mgr.autoExtendSession("default");

      expect(result).toBe(false);
      expect(silentRefresh).toHaveBeenCalledWith("default");
    });

    test("returns false when profile has no cookies file", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("ghost");

      const silentRefresh = mock(async (_profileName: string) => true);

      const mgr = createManager(manager, undefined, silentRefresh);
      const result = await mgr.autoExtendSession("ghost");

      expect(result).toBe(false);
      expect(silentRefresh).not.toHaveBeenCalled();
    });
  });

  describe("getActiveProfiles", () => {
    test("returns profiles with valid cookies", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("active");
      manager.create("expired");
      storage.save("active", makeValidCookies());
      storage.save("expired", makeExpiredCookies());

      const mgr = createManager(manager);
      const active = mgr.getActiveProfiles();

      expect(active).toContain("active");
      expect(active).not.toContain("expired");
    });

    test("returns empty array when no profiles have valid cookies", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("p1");
      storage.save("p1", makeExpiredCookies());

      const mgr = createManager(manager);
      const active = mgr.getActiveProfiles();

      expect(active).toEqual([]);
    });

    test("returns empty array when no profiles exist", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const mgr = createManager(manager);
      const active = mgr.getActiveProfiles();

      expect(active).toEqual([]);
    });
  });

  describe("findProfileForConversation", () => {
    test("returns the profile that owns the conversation", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("work");
      manager.create("personal");
      storage.save("work", makeValidCookies());
      storage.save("personal", makeValidCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string) {
          return profileName === "work";
        },
        async models() { return []; },
        async forProfile() { return this as unknown as IGeminiClientService; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as IGeminiClientService);
      const result = await mgr.findProfileForConversation("conv-123");

      expect(result).toBe("work");
    });

    test("returns null when no profile owns the conversation", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("p1");
      storage.save("p1", makeExpiredCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation() { return false; },
        async models() { return []; },
        async forProfile() { return this as unknown as IGeminiClientService; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as IGeminiClientService);
      const result = await mgr.findProfileForConversation("conv-456");

      expect(result).toBeNull();
    });

    test("returns null when no profiles exist", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const mgr = createManager(manager);

      const result = await mgr.findProfileForConversation("conv-789");

      expect(result).toBeNull();
    });

    test("returns null when conversation is not in any profile", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("work");
      manager.create("personal");
      storage.save("work", makeValidCookies());
      storage.save("personal", makeValidCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation() { return false; },
        async models() { return []; },
        async forProfile() { return this as unknown as IGeminiClientService; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as IGeminiClientService);
      const result = await mgr.findProfileForConversation("conv-999");

      expect(result).toBeNull();
    });

    test("returns first profile in list order when multiple profiles report ownership", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("profile1");
      manager.create("profile2");
      manager.create("profile3");
      storage.save("profile1", makeValidCookies());
      storage.save("profile2", makeValidCookies());
      storage.save("profile3", makeValidCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string) {
          return profileName === "profile1" || profileName === "profile3";
        },
        async models() { return []; },
        async forProfile() { return this as unknown as IGeminiClientService; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as IGeminiClientService);
      const result = await mgr.findProfileForConversation("conv-shared");

      expect(result).toBe("profile1");
    });

    test("passes the conversationId argument to the lookup helper", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("work");
      storage.save("work", makeValidCookies());

      const calls: Array<[string, string]> = [];
      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string, conversationId: string) {
          calls.push([profileName, conversationId]);
          return false;
        },
        async models() { return []; },
        async forProfile() { return this as unknown as IGeminiClientService; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as IGeminiClientService);
      await mgr.findProfileForConversation("abc-123");

      expect(calls).toContainEqual(["work", "abc-123"]);
    });

    test("does not probe profiles whose cookies are expired", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("alive");
      manager.create("dead");
      storage.save("alive", makeValidCookies());
      storage.save("dead", makeExpiredCookies());

      const probedNames: string[] = [];
      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string) {
          probedNames.push(profileName);
          return false;
        },
        async models() { return []; },
        async forProfile() { return this as unknown as IGeminiClientService; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as IGeminiClientService);
      await mgr.findProfileForConversation("conv-xyz");

      expect(probedNames).toContain("alive");
      expect(probedNames).not.toContain("dead");
    });
  });

  describe("server-side probe", () => {
    function gimme(
      modelsImpl: ReturnType<typeof mock>,
    ): IGeminiClientService {
      return {
        models: modelsImpl as unknown as IGeminiClientService["models"],
        async forProfile() { return this as unknown as IGeminiClientService; },
        async deleteChat() {},
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation() { return false; },
      };
    }

    beforeEach(() => {
      delete process.env.GEMITERM_PROBE_TTL_MS;
    });
    afterEach(() => {
      delete process.env.GEMITERM_PROBE_TTL_MS;
    });

    test("models() succeeds still rotates (stale 1PSIDTS detection) and logs authenticated", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: true, attempted: true }));

      const infoSpy = mock(() => {});
      const testLogger = new Logger("test");
      testLogger.info = infoSpy;

      const cookieStorage = new CookieStorageService({ cookieStorage: storage, logger: testLogger });
      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: cookieStorage,
        logger: testLogger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(modelsFn).toHaveBeenCalledTimes(1);
      expect(rotateCookies).toHaveBeenCalledTimes(1);
      expect(rotateCookies).toHaveBeenCalledWith("default");
      expect(silentRefresh).toHaveBeenCalledTimes(0);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Profile 'default' is authenticated"),
      );
    });

    test("models() throws triggers silent refresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => {
        throw new Error("network error");
      });
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);

      const mgr = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh);

      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(modelsFn).toHaveBeenCalledTimes(2);
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default", { mode: "targeted" });
    });

    test("models() throws + silent refresh fails continues (dormancy-resilient)", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => {
        throw new Error("network error");
      });
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => false);

      const mgr = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh);

      const cookies = await mgr.ensureAuthenticated("default");
      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(modelsFn).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledWith("default", { mode: "targeted" });
    });

    test("probe cache TTL: repeat ensureAuthenticated within TTL reuses cached result", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: true, attempted: true }));

      const mgr = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh, rotateCookies);

      const r1 = await mgr.ensureAuthenticated("default");
      const r2 = await mgr.ensureAuthenticated("default");
      const r3 = await mgr.ensureAuthenticated("default");

      expect(r1.secure_1psid).toBe("test-psid-value");
      expect(r2.secure_1psid).toBe("test-psid-value");
      expect(r3.secure_1psid).toBe("test-psid-value");
      expect(modelsFn).toHaveBeenCalledTimes(1);
      expect(rotateCookies).toHaveBeenCalledTimes(3);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("separate ProfileAuthManager instances each perform their own probe", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: true, attempted: true }));

      const mgr1 = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh, rotateCookies);
      const mgr2 = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh, rotateCookies);

      await mgr1.ensureAuthenticated("default");
      await mgr2.ensureAuthenticated("default");

      expect(modelsFn).toHaveBeenCalledTimes(2);
      expect(rotateCookies).toHaveBeenCalledTimes(2);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("rotates cookies even when models() succeeds (stale __Secure-1PSIDTS detection)", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: true, attempted: true }));

      const mgr = createManager(manager, geminiClient as unknown as IGeminiClientService, silentRefresh, rotateCookies);

      await mgr.ensureAuthenticated("default");

      expect(rotateCookies).toHaveBeenCalledWith("default");
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("L1 RotateCookies reached Google but server declined (attempted, not rotated) does NOT escalate to L2 silentRefresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: true }));

      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: new CookieStorageService({ cookieStorage: storage, logger }),
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      await mgr.ensureAuthenticated("default");

      expect(rotateCookies).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });

    test("L1 RotateCookies throttled/skipped (not attempted) does NOT escalate to L2 silentRefresh", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const modelsFn = mock(async () => ["gemini-2.5-flash"]);
      const geminiClient = gimme(modelsFn);

      const silentRefresh = mock(async (_profileName: string) => true);
      const rotateCookies = mock(async (_profileName: string) => ({ rotated: false, attempted: false }));

      const mgr = new ProfileAuthManager({
        profileManager: manager,
        cookieStorageService: new CookieStorageService({ cookieStorage: storage, logger }),
        logger,
        geminiClient: geminiClient as unknown as IGeminiClientService,
        silentRefresh,
        rotateCookies,
      });

      await mgr.ensureAuthenticated("default");

      expect(rotateCookies).toHaveBeenCalledTimes(1);
      expect(silentRefresh).toHaveBeenCalledTimes(0);
    });




  });
});
