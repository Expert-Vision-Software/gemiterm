import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { ProfileManager as ProfileManagerType } from "../../src/infrastructure/storage.ts";

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
): ProfileAuthManager {
  const cookieStorage = new CookieStorageService({
    cookieStorage: new CookieStorage(),
    logger,
  });
  return new ProfileAuthManager({ profileManager, cookieStorageService: cookieStorage, logger });
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
    test("returns cookies for a profile with valid session", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const mgr = createManager(manager);
      const cookies = mgr.ensureAuthenticated("default");

      expect(cookies.secure_1psid).toBe("test-psid-value");
      expect(cookies.secure_1psidts).toBe("test-psidts-value");
    });

    test("throws AuthenticationError when no valid cookies", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");

      const mgr = createManager(manager);

      expect(() => mgr.ensureAuthenticated("default")).toThrow("No valid session");
    });

    test("throws AuthenticationError with expired cookies", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeExpiredCookies());

      const mgr = createManager(manager);

      expect(() => mgr.ensureAuthenticated("default")).toThrow("No valid session");
    });

    test("throws on invalid profile name", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const mgr = createManager(manager);

      expect(() => mgr.ensureAuthenticated("bad name!")).toThrow("invalid characters");
    });

    test("uses default profile when none specified", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("default");
      storage.save("default", makeValidCookies());

      const markerDir = join(TEST_DIR, "config");
      mkdirSync(markerDir, { recursive: true });
      writeFileSync(join(markerDir, "default-profile"), "default", "utf-8");

      const mgr = createManager(manager);
      const cookies = mgr.ensureAuthenticated();

      expect(cookies.secure_1psid).toBe("test-psid-value");
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
    test("returns first active profile", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("alpha");
      manager.create("beta");
      storage.save("alpha", makeValidCookies());
      storage.save("beta", makeExpiredCookies());

      const mgr = createManager(manager);
      const result = mgr.findProfileForConversation("conv-123");

      expect(result).toBe("alpha");
    });

    test("returns null when no active profiles", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("p1");
      storage.save("p1", makeExpiredCookies());

      const mgr = createManager(manager);
      const result = mgr.findProfileForConversation("conv-456");

      expect(result).toBeNull();
    });

    test("returns null when no profiles exist", () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const mgr = createManager(manager);

      const result = mgr.findProfileForConversation("conv-789");

      expect(result).toBeNull();
    });
  });
});
