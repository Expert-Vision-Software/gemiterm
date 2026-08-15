import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CookieStorage, ProfileManager } from "../../src/infrastructure/storage.ts";
import { CookieSession } from "../../src/services/cookie-session.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-storage");

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

function makeExpiredCookies(): Cookie[] {
  const past = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "expired-psid",
      domain: ".google.com",
      path: "/",
      expires: past,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "expired-psidts",
      domain: ".google.com",
      path: "/",
      expires: past,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

describe("CookieStorage", () => {
  let storage: CookieStorage;

  beforeEach(() => {
    storage = new CookieStorage();
  });

  test("saves and loads cookies for a profile", () => {
    const cookies = makeValidCookies();
    storage.save("test-profile", cookies);

    const loaded = storage.load("test-profile");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe("__Secure-1PSID");
    expect(loaded[1].name).toBe("__Secure-1PSIDTS");
  });

  test("throws when loading non-existent profile", () => {
    expect(() => storage.load("nonexistent")).toThrow("No storage state found");
  });

  test("deletes profile directory", () => {
    storage.save("to-delete", makeValidCookies());
    expect(existsSync(join(TEST_DIR, "profiles", "to-delete"))).toBe(true);

    storage.delete("to-delete");
    expect(existsSync(join(TEST_DIR, "profiles", "to-delete"))).toBe(false);
  });

  test("delete is a no-op for non-existent profile", () => {
    expect(() => storage.delete("nonexistent")).not.toThrow();
  });

  test("list returns empty array when no profiles exist", () => {
    expect(storage.list()).toEqual([]);
  });

  test("list returns saved profile names", () => {
    storage.save("alpha", makeValidCookies());
    storage.save("beta", makeValidCookies());

    const names = storage.list();
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  test("overwrites existing cookies on save", () => {
    storage.save("overwrite", makeValidCookies());
    const newCookies = [
      { ...makeValidCookies()[0], value: "new-value" },
      { ...makeValidCookies()[1], value: "new-ts-value" },
    ];
    storage.save("overwrite", newCookies);

    const loaded = storage.load("overwrite");
    expect(loaded[0].value).toBe("new-value");
  });
});

describe("ProfileManager", () => {
  let manager: ProfileManager;

  beforeEach(() => {
    manager = new ProfileManager();
  });

  test("create creates profile directory", () => {
    manager.create("new-profile");
    expect(existsSync(join(TEST_DIR, "profiles", "new-profile"))).toBe(true);
  });

  test("create sets first profile as default", () => {
    manager.create("first");
    expect(manager.getDefault()).toBe("first");
  });

  test("create does not change default if profiles already exist", () => {
    manager.create("first");
    manager.create("second");
    expect(manager.getDefault()).toBe("first");
  });

  test("create throws if profile already exists", () => {
    manager.create("dup");
    expect(() => manager.create("dup")).toThrow("already exists");
  });

  test("delete removes profile directory and resets default", () => {
    manager.create("p1");
    manager.create("p2");
    manager.setDefault("p1");

    manager.delete("p1");
    expect(manager.getDefault()).toBe("p2");
    expect(manager.list()).not.toContain("p1");
  });

  test("delete resets default to remaining profile", () => {
    manager.create("solo");
    manager.delete("solo");
    expect(manager.list()).toEqual([]);
  });

  test("rename moves profile directory", () => {
    manager.create("old-name");
    manager.rename("old-name", "new-name");

    expect(manager.list()).toContain("new-name");
    expect(manager.list()).not.toContain("old-name");
    expect(existsSync(join(TEST_DIR, "profiles", "new-name"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "profiles", "old-name"))).toBe(false);
  });

  test("rename updates default if renamed profile was default", () => {
    manager.create("default-profile");
    manager.rename("default-profile", "renamed");

    expect(manager.getDefault()).toBe("renamed");
  });

  test("rename throws if source does not exist", () => {
    expect(() => manager.rename("nope", "dest")).toThrow("does not exist");
  });

  test("rename throws if destination already exists", () => {
    manager.create("a");
    manager.create("b");
    expect(() => manager.rename("a", "b")).toThrow("already exists");
  });

  test("setDefault throws if profile does not exist", () => {
    expect(() => manager.setDefault("ghost")).toThrow("does not exist");
  });

  test("setDefault sets the default profile name", () => {
    manager.create("p1");
    manager.create("p2");
    manager.setDefault("p2");
    expect(manager.getDefault()).toBe("p2");
  });

  test("getStatus returns correct data for existing valid profile", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("active", makeValidCookies());

    const status = mgr.getStatus("active");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(true);
    expect(status.expiresAt).not.toBeNull();
    expect(status.lastUsedAt).not.toBeNull();
    expect(status.isDefault).toBe(false);
  });

  test("getStatus returns inactive for expired cookies", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("expired", makeExpiredCookies());

    const status = mgr.getStatus("expired");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(false);
  });

  test("getStatus returns active for session cookies (expires: -1)", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    const sessionCookies: Cookie[] = [
      {
        name: "__Secure-1PSID",
        value: "psid",
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "__Secure-1PSIDTS",
        value: "psidts",
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ];
    storage.save("session", sessionCookies);

    const status = mgr.getStatus("session");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(true);
    expect(status.expiresAt).toBeNull();
  });

  test("getStatus expiresAt is the max across tracked cookies (mixed fixture)", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    const soon = Math.floor(Date.now() / 1000) + 10 * 60;
    const later = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const mixed: Cookie[] = [
      {
        name: "__Secure-1PSID",
        value: "psid",
        domain: ".google.com",
        path: "/",
        expires: later,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "__Secure-1PSIDTS",
        value: "psidts",
        domain: ".google.com",
        path: "/",
        expires: soon,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ];
    storage.save("mixed", mixed);

    const status = mgr.getStatus("mixed");
    expect(status.expiresAt).toBe(new Date(later * 1000).toISOString());
  });

  test("getStatus returns not exists for missing profile", () => {
    const status = manager.getStatus("missing");
    expect(status.exists).toBe(false);
    expect(status.isActive).toBe(false);
  });

  test("getStatus is active after a capture commit of session cookies (expires -1)", () => {
    const storage = new CookieStorage();
    const session = new CookieSession({ cookieStorage: storage, logger: new Logger("test") });
    const mgr = new ProfileManager(storage, session);

    session.commit("captured", [
      {
        name: "__Secure-1PSID",
        value: "psid",
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "__Secure-1PSIDTS",
        value: "ts",
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    const status = mgr.getStatus("captured");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(true);
    expect(status.expiresAt).toBeNull();
  });

  test("getStatus marks the default profile", () => {
    manager.create("def");
    const status = manager.getStatus("def");
    expect(status.isDefault).toBe(true);
  });

  test("getAllStatuses returns all profile statuses", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("active", makeValidCookies());
    storage.save("expired", makeExpiredCookies());

    const statuses = mgr.getAllStatuses();
    expect(statuses).toHaveLength(2);
    const active = statuses.find((s) => s.name === "active")!;
    const expired = statuses.find((s) => s.name === "expired")!;
    expect(active.isActive).toBe(true);
    expect(expired.isActive).toBe(false);
  });

  test("hasValidCookies returns true for fresh cookies", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("fresh", makeValidCookies());

    expect(mgr.hasValidCookies("fresh")).toBe(true);
  });

  test("hasValidCookies returns false for expired cookies", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("stale", makeExpiredCookies());

    expect(mgr.hasValidCookies("stale")).toBe(false);
  });

  test("hasValidCookies returns false for missing profile", () => {
    expect(manager.hasValidCookies("nope")).toBe(false);
  });

  test("loadCookiesForApi returns cookie values", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("api-test", makeValidCookies());

    const result = mgr.loadCookiesForApi("api-test");
    expect(result.secure1psid).toBe("test-psid-value");
    expect(result.secure1psidts).toBe("test-psidts-value");
  });

  test("loadCookiesForApi throws for expired cookies", () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    storage.save("expired-api", makeExpiredCookies());

    expect(() => mgr.loadCookiesForApi("expired-api")).toThrow("expired");
  });

  test("loadCookiesForApi throws for missing profile", () => {
    expect(() => manager.loadCookiesForApi("ghost")).toThrow("No storage state found");
  });
});
