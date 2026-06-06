import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileService } from "../../src/services/profile-service.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-profile-service");

const logger = new Logger("test");

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GEMITERM_CONFIG_DIR;
});

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

function setupAuthenticatedProfile(profileName = "default"): ProfileService {
  const storage = new CookieStorage();
  const manager = new ProfileManager(storage);
  storage.save(profileName, makeValidCookies());

  const markerDir = join(TEST_DIR, "config");
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(markerDir, "default-profile"), profileName, "utf-8");

  return new ProfileService(manager, logger);
}

describe("ProfileService", () => {
  describe("authenticate", () => {
    test("authenticates with valid cookies", async () => {
      const svc = setupAuthenticatedProfile();
      const result = await svc.authenticate();

      expect(result.cookies).toHaveLength(2);
      expect(result.cookies[0].name).toBe("__Secure-1PSID");
      expect(result.cookies[0].value).toBe("test-psid-value");
      expect(result.expiresAt).not.toBeNull();
    });

    test("throws AuthenticationError when no valid cookies exist", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      await expect(svc.authenticate("default")).rejects.toThrow("No valid session");
    });

    test("creates profile if it does not exist and authenticates", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      storage.save("default", makeValidCookies());

      const markerDir = join(TEST_DIR, "config");
      mkdirSync(markerDir, { recursive: true });
      writeFileSync(join(markerDir, "default-profile"), "default", "utf-8");

      const svc = new ProfileService(manager, logger);
      const result = await svc.authenticate("default");

      expect(result.cookies).toHaveLength(2);
      expect(result.cookies[0].name).toBe("__Secure-1PSID");
    });

    test("throws on invalid profile name", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      await expect(svc.authenticate("bad name!")).rejects.toThrow("invalid characters");
    });
  });

  describe("getProfileStatuses", () => {
    test("returns statuses for all profiles", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      storage.save("active", makeValidCookies());

      const svc = new ProfileService(manager, logger);
      const statuses = await svc.getProfileStatuses();

      expect(statuses.length).toBeGreaterThan(0);
      const active = statuses.find((s) => s.name === "active");
      expect(active).toBeDefined();
      expect(active!.isActive).toBe(true);
    });

    test("returns empty array when no profiles exist", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      const statuses = await svc.getProfileStatuses();
      expect(statuses).toEqual([]);
    });
  });

  describe("getAuthStatus", () => {
    test("returns authenticated when default profile has valid cookies", async () => {
      const svc = setupAuthenticatedProfile();
      const status = await svc.getAuthStatus();

      expect(status.authenticated).toBe(true);
      expect(status.profileName).toBe("default");
    });

    test("returns not authenticated when default has no cookies", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      const status = await svc.getAuthStatus();
      expect(status.authenticated).toBe(false);
    });
  });

  describe("deleteProfile", () => {
    test("deletes an existing profile", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("to-delete");
      storage.save("to-delete", makeValidCookies());

      const svc = new ProfileService(manager, logger);
      await svc.deleteProfile("to-delete");

      expect(manager.list()).not.toContain("to-delete");
    });

    test("throws on non-existent profile", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      await expect(svc.deleteProfile("ghost")).rejects.toThrow("does not exist");
    });

    test("throws on invalid profile name", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      await expect(svc.deleteProfile("bad name!")).rejects.toThrow("invalid characters");
    });
  });

  describe("renameProfile", () => {
    test("renames an existing profile", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("old-name");

      const svc = new ProfileService(manager, logger);
      await svc.renameProfile("old-name", "new-name");

      expect(manager.list()).toContain("new-name");
      expect(manager.list()).not.toContain("old-name");
    });

    test("throws on invalid names", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      await expect(svc.renameProfile("old", "new!")).rejects.toThrow("invalid characters");
    });
  });

  describe("setDefaultProfile", () => {
    test("sets the default profile", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      manager.create("p1");
      manager.create("p2");

      const svc = new ProfileService(manager, logger);
      await svc.setDefaultProfile("p2");

      expect(manager.getDefault()).toBe("p2");
    });

    test("throws on invalid profile name", async () => {
      const storage = new CookieStorage();
      const manager = new ProfileManager(storage);
      const svc = new ProfileService(manager, logger);

      await expect(svc.setDefaultProfile("bad!")).rejects.toThrow("invalid characters");
    });
  });
});
