import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CookieStorage, ProfileManager } from "../../src/infrastructure/storage.ts";
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

  test("saves and loads cookies for a profile", async () => {
    const cookies = makeValidCookies();
    await storage.save("test-profile", cookies);

    const loaded = await storage.load("test-profile");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe("__Secure-1PSID");
    expect(loaded[1].name).toBe("__Secure-1PSIDTS");
  });

  test("throws when loading non-existent profile", async () => {
    await expect(storage.load("nonexistent")).rejects.toThrow("No storage state found");
  });

  test("deletes profile directory", async () => {
    await storage.save("to-delete", makeValidCookies());
    expect(existsSync(join(TEST_DIR, "profiles", "to-delete"))).toBe(true);

    await storage.delete("to-delete");
    expect(existsSync(join(TEST_DIR, "profiles", "to-delete"))).toBe(false);
  });

  test("delete is a no-op for non-existent profile", async () => {
    await expect(storage.delete("nonexistent")).resolves.toBeUndefined();
  });

  test("list returns empty array when no profiles exist", async () => {
    expect(await storage.list()).toEqual([]);
  });

  test("list returns saved profile names", async () => {
    await storage.save("alpha", makeValidCookies());
    await storage.save("beta", makeValidCookies());

    const names = await storage.list();
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  test("overwrites existing cookies on save", async () => {
    await storage.save("overwrite", makeValidCookies());
    const newCookies = [
      { ...makeValidCookies()[0], value: "new-value" },
      { ...makeValidCookies()[1], value: "new-ts-value" },
    ];
    await storage.save("overwrite", newCookies);

    const loaded = await storage.load("overwrite");
    expect(loaded[0].value).toBe("new-value");
  });
});

describe("ProfileManager", () => {
  let manager: ProfileManager;

  beforeEach(() => {
    manager = new ProfileManager();
  });

  test("create creates profile directory", async () => {
    await manager.create("new-profile");
    expect(existsSync(join(TEST_DIR, "profiles", "new-profile"))).toBe(true);
  });

  test("create sets first profile as default", async () => {
    await manager.create("first");
    expect(await manager.getDefault()).toBe("first");
  });

  test("create does not change default if profiles already exist", async () => {
    await manager.create("first");
    await manager.create("second");
    expect(await manager.getDefault()).toBe("first");
  });

  test("create throws if profile already exists", async () => {
    await manager.create("dup");
    await expect(manager.create("dup")).rejects.toThrow("already exists");
  });

  test("delete removes profile directory and resets default", async () => {
    await manager.create("p1");
    await manager.create("p2");
    await manager.setDefault("p1");

    await manager.delete("p1");
    expect(await manager.getDefault()).toBe("p2");
    expect(await manager.list()).not.toContain("p1");
  });

  test("delete resets default to remaining profile", async () => {
    await manager.create("solo");
    await manager.delete("solo");
    expect(await manager.list()).toEqual([]);
  });

  test("rename moves profile directory", async () => {
    await manager.create("old-name");
    await manager.rename("old-name", "new-name");

    expect(await manager.list()).toContain("new-name");
    expect(await manager.list()).not.toContain("old-name");
    expect(existsSync(join(TEST_DIR, "profiles", "new-name"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "profiles", "old-name"))).toBe(false);
  });

  test("rename updates default if renamed profile was default", async () => {
    await manager.create("default-profile");
    await manager.rename("default-profile", "renamed");

    expect(await manager.getDefault()).toBe("renamed");
  });

  test("rename throws if source does not exist", async () => {
    await expect(manager.rename("nope", "dest")).rejects.toThrow("does not exist");
  });

  test("rename throws if destination already exists", async () => {
    await manager.create("a");
    await manager.create("b");
    await expect(manager.rename("a", "b")).rejects.toThrow("already exists");
  });

  test("setDefault throws if profile does not exist", async () => {
    await expect(manager.setDefault("ghost")).rejects.toThrow("does not exist");
  });

  test("setDefault sets the default profile name", async () => {
    await manager.create("p1");
    await manager.create("p2");
    await manager.setDefault("p2");
    expect(await manager.getDefault()).toBe("p2");
  });

  test("getStatus returns correct data for existing valid profile", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("active", makeValidCookies());

    const status = await mgr.getStatus("active");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(true);
    expect(status.expiresAt).not.toBeNull();
    expect(status.lastUsedAt).not.toBeNull();
    expect(status.isDefault).toBe(false);
  });

  test("getStatus returns inactive for expired cookies", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("expired", makeExpiredCookies());

    const status = await mgr.getStatus("expired");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(false);
  });

  test("getStatus returns active for session cookies (expires: -1)", async () => {
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
    await storage.save("session", sessionCookies);

    const status = await mgr.getStatus("session");
    expect(status.exists).toBe(true);
    expect(status.isActive).toBe(true);
    expect(status.expiresAt).toBeNull();
  });

  test("getStatus returns not exists for missing profile", async () => {
    const status = await manager.getStatus("missing");
    expect(status.exists).toBe(false);
    expect(status.isActive).toBe(false);
  });

  test("getStatus marks the default profile", async () => {
    await manager.create("def");
    const status = await manager.getStatus("def");
    expect(status.isDefault).toBe(true);
  });

  test("getAllStatuses returns all profile statuses", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("active", makeValidCookies());
    await storage.save("expired", makeExpiredCookies());

    const statuses = await mgr.getAllStatuses();
    expect(statuses).toHaveLength(2);
    const active = statuses.find((s) => s.name === "active")!;
    const expired = statuses.find((s) => s.name === "expired")!;
    expect(active.isActive).toBe(true);
    expect(expired.isActive).toBe(false);
  });

  test("hasValidCookies returns true for fresh cookies", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("fresh", makeValidCookies());

    expect(await mgr.hasValidCookies("fresh")).toBe(true);
  });

  test("hasValidCookies returns false for expired cookies", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("stale", makeExpiredCookies());

    expect(await mgr.hasValidCookies("stale")).toBe(false);
  });

  test("hasValidCookies returns false for missing profile", async () => {
    expect(await manager.hasValidCookies("nope")).toBe(false);
  });

  test("loadCookiesForApi returns cookie values", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("api-test", makeValidCookies());

    const result = await mgr.loadCookiesForApi("api-test");
    expect(result.secure1psid).toBe("test-psid-value");
    expect(result.secure1psidts).toBe("test-psidts-value");
  });

  test("loadCookiesForApi throws for expired cookies", async () => {
    const storage = new CookieStorage();
    const mgr = new ProfileManager(storage);
    await storage.save("expired-api", makeExpiredCookies());

    await expect(mgr.loadCookiesForApi("expired-api")).rejects.toThrow("expired");
  });

  test("loadCookiesForApi throws for missing profile", async () => {
    await expect(manager.loadCookiesForApi("ghost")).rejects.toThrow("No storage state found");
  });
});
