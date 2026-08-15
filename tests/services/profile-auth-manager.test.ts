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

type GeminiClientLike = {
  profileHasConversation(profileName: string, conversationId: string): Promise<boolean>;
};

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
  geminiClient?: GeminiClientLike,
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
      forProfile() { return this as unknown as GeminiClientLike; },
    },
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
      await manager.create("default");
      await storage.save("default", makeValidCookies());

      const mgr = createManager(manager);
      const cookies = await mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(cookies.secure_1psidts).toBe("test-psidts-value");
    });

    test("throws AuthenticationError when no valid cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("default");

      const mgr = createManager(manager);

      await expect(mgr.ensureAuthenticated("default")).rejects.toThrow("No valid session");
    });

    test("throws AuthenticationError with expired cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("default");
      await storage.save("default", makeExpiredCookies());

      const mgr = createManager(manager);

      await expect(mgr.ensureAuthenticated("default")).rejects.toThrow("No valid session");
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
      await manager.create("default");
      await storage.save("default", makeValidCookies());

      const markerDir = join(TEST_DIR, "config");
      mkdirSync(markerDir, { recursive: true });
      writeFileSync(join(markerDir, "default-profile"), "default", "utf-8");

      const mgr = createManager(manager);
      const cookies = await mgr.ensureAuthenticated();

      expect(cookies.secure_1psid).toBe("test-psid-value");
    });
  });

  describe("getActiveProfiles", () => {
    test("returns profiles with valid cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("active");
      await manager.create("expired");
      await storage.save("active", makeValidCookies());
      await storage.save("expired", makeExpiredCookies());

      const mgr = createManager(manager);
      const active = await mgr.getActiveProfiles();

      expect(active).toContain("active");
      expect(active).not.toContain("expired");
    });

    test("returns empty array when no profiles have valid cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("p1");
      await storage.save("p1", makeExpiredCookies());

      const mgr = createManager(manager);
      const active = await mgr.getActiveProfiles();

      expect(active).toEqual([]);
    });

    test("returns empty array when no profiles exist", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const mgr = createManager(manager);
      const active = await mgr.getActiveProfiles();

      expect(active).toEqual([]);
    });
  });

  describe("findProfileForConversation", () => {
    test("returns the profile that owns the conversation", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("work");
      await manager.create("personal");
      await storage.save("work", makeValidCookies());
      await storage.save("personal", makeValidCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string) {
          return profileName === "work";
        },
        forProfile() { return this as unknown as GeminiClientLike; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as GeminiClientLike);
      const result = await mgr.findProfileForConversation("conv-123");

      expect(result).toBe("work");
    });

    test("returns null when no profile owns the conversation", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("p1");
      await storage.save("p1", makeExpiredCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation() { return false; },
        forProfile() { return this as unknown as GeminiClientLike; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as GeminiClientLike);
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
      await manager.create("work");
      await manager.create("personal");
      await storage.save("work", makeValidCookies());
      await storage.save("personal", makeValidCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation() { return false; },
        forProfile() { return this as unknown as GeminiClientLike; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as GeminiClientLike);
      const result = await mgr.findProfileForConversation("conv-999");

      expect(result).toBeNull();
    });

    test("returns first profile in list order when multiple profiles report ownership", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("profile1");
      await manager.create("profile2");
      await manager.create("profile3");
      await storage.save("profile1", makeValidCookies());
      await storage.save("profile2", makeValidCookies());
      await storage.save("profile3", makeValidCookies());

      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string) {
          return profileName === "profile1" || profileName === "profile3";
        },
        forProfile() { return this as unknown as GeminiClientLike; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as GeminiClientLike);
      const result = await mgr.findProfileForConversation("conv-shared");

      expect(result).toBe("profile1");
    });

    test("passes the conversationId argument to the lookup helper", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("work");
      await storage.save("work", makeValidCookies());

      const calls: Array<[string, string]> = [];
      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string, conversationId: string) {
          calls.push([profileName, conversationId]);
          return false;
        },
        forProfile() { return this as unknown as GeminiClientLike; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as GeminiClientLike);
      await mgr.findProfileForConversation("abc-123");

      expect(calls).toContainEqual(["work", "abc-123"]);
    });

    test("does not probe profiles whose cookies are expired", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      await manager.create("alive");
      await manager.create("dead");
      await storage.save("alive", makeValidCookies());
      await storage.save("dead", makeExpiredCookies());

      const probedNames: string[] = [];
      const mockGeminiClient = {
        async deleteChat() { return; },
        async sendMessage() { return ""; },
        async startNewChat() { return { response: "", conversationId: "" }; },
        async profileHasConversation(profileName: string) {
          probedNames.push(profileName);
          return false;
        },
        forProfile() { return this as unknown as GeminiClientLike; },
      };

      const mgr = createManager(manager, mockGeminiClient as unknown as GeminiClientLike);
      await mgr.findProfileForConversation("conv-xyz");

      expect(probedNames).toContain("alive");
      expect(probedNames).not.toContain("dead");
    });
  });
});
