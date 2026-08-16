import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { LockUnavailableError } from "../../src/core/errors.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-cookie-store");

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GEMITERM_CONFIG_DIR;
});

function cookie(name: string, value: string, domain = ".google.com", path = "/"): Cookie {
  return {
    name,
    value,
    domain,
    path,
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

function writeJar(profile: string, cookies: Cookie[]): void {
  const dir = join(TEST_DIR, "profiles", profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "storage_state.json"), JSON.stringify({ cookies }, null, 2), "utf-8");
}

function readJar(profile: string): Cookie[] {
  const raw = readFileSync(join(TEST_DIR, "profiles", profile, "storage_state.json"), "utf-8");
  return JSON.parse(raw).cookies as Cookie[];
}

function lockPathFor(profile: string): string {
  return join(TEST_DIR, "profiles", profile, "storage_state.json.lock");
}

function holdLock(profile: string): void {
  writeFileSync(lockPathFor(profile), String(process.pid), "utf-8");
}

function fastStore(): CookieStore {
  return new CookieStore({ retryMs: 20, casLockTimeoutMs: 100, fullLockTimeoutMs: 150, staleLockMs: 200 });
}

describe("CookieStore.load", () => {
  test("returns cookies plus snapshot keyed by (name,domain,path) -> value", async () => {
    writeJar("p", [cookie("__Secure-1PSID", "a"), cookie("__Secure-1PSIDTS", "b"), cookie("SID", "c")]);
    const store = new CookieStore();
    const loaded = await store.load("p");
    expect(loaded.cookies.map((c) => c.name).sort()).toEqual(["SID", "__Secure-1PSID", "__Secure-1PSIDTS"]);
    expect(loaded.snapshot.get("__Secure-1PSID|.google.com|/")).toBe("a");
    expect(loaded.snapshot.get("__Secure-1PSIDTS|.google.com|/")).toBe("b");
    expect(loaded.snapshot.size).toBe(3);
  });

  test("rejects when no storage state exists", async () => {
    const store = new CookieStore();
    await expect(store.load("missing")).rejects.toThrow(/No storage state found for profile 'missing'/);
  });

  test("exposes jar mtime", async () => {
    writeJar("p", [cookie("SID", "x")]);
    const store = new CookieStore();
    const mtime = await store.getJarMtime("p");
    expect(mtime).not.toBeNull();
    expect(mtime!.getTime()).toBeGreaterThan(0);
    expect(await store.getJarMtime("nope")).toBeNull();
  });
});

describe("CookieStore CAS save", () => {
  test("round-trips through the storage format", async () => {
    writeJar("p", [cookie("SID", "old"), cookie("HSID", "h")]);
    const store = new CookieStore();
    const { snapshot } = await store.load("p");
    await store.save("p", [cookie("SID", "new"), cookie("HSID", "h")], snapshot);
    const reloaded = await store.load("p");
    expect(reloaded.cookies.map((c) => [c.name, c.value]).sort()).toEqual([
      ["HSID", "h"],
      ["SID", "new"],
    ]);
  });

  test("stale process cannot clobber a sibling's fresh rotation", async () => {
    writeJar("p", [cookie("__Secure-1PSIDTS", "old-ts"), cookie("SID", "sid")]);
    const storeA = new CookieStore();
    const { cookies, snapshot } = await storeA.load("p");

    const storeB = new CookieStore();
    await storeB.saveFullJar("p", [...cookies.map((c) => (c.name === "__Secure-1PSIDTS" ? { ...c, value: "rotated-ts" } : c))]);

    const unrelated = cookies.map((c) => (c.name === "SID" ? { ...c, value: "sid2" } : c));
    await storeA.save("p", unrelated, snapshot);

    const disk = readJar("p");
    const psidts = disk.find((c) => c.name === "__Secure-1PSIDTS")!;
    const sid = disk.find((c) => c.name === "SID")!;
    expect(psidts.value).toBe("rotated-ts");
    expect(sid.value).toBe("sid2");
  });

  test("keeps concurrent additions this process never saw", async () => {
    writeJar("p", [cookie("SID", "sid")]);
    const storeA = new CookieStore();
    const { cookies, snapshot } = await storeA.load("p");

    const storeB = new CookieStore();
    await storeB.saveFullJar("p", [...cookies, cookie("NID", "fresh-nid")]);

    await storeA.save("p", [...cookies.map((c) => (c.name === "SID" ? { ...c, value: "sid2" } : c))], snapshot);

    const disk = readJar("p");
    expect(disk.find((c) => c.name === "NID")!.value).toBe("fresh-nid");
    expect(disk.find((c) => c.name === "SID")!.value).toBe("sid2");
  });
});

describe("CookieStore lock", () => {
  test("CAS save proceeds when the lock is held too long (fail-open)", async () => {
    writeJar("p", [cookie("SID", "old")]);
    holdLock("p");
    const store = fastStore();
    const { snapshot } = await store.load("p");
    await store.save("p", [cookie("SID", "new")], snapshot);
    expect(readJar("p").find((c) => c.name === "SID")!.value).toBe("new");
  });

  test("full-jar writer fails closed with LockUnavailableError", async () => {
    writeJar("p", [cookie("SID", "old")]);
    holdLock("p");
    const store = fastStore();
    await expect(store.saveFullJar("p", [cookie("SID", "new")])).rejects.toBeInstanceOf(LockUnavailableError);
    expect(readJar("p").find((c) => c.name === "SID")!.value).toBe("old");
  });

  test("stale lock (mtime older than threshold) is stolen", async () => {
    writeJar("p", [cookie("SID", "old")]);
    holdLock("p");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPathFor("p"), old, old);

    const store = fastStore();
    await store.saveFullJar("p", [cookie("SID", "new")]);
    expect(readJar("p").find((c) => c.name === "SID")!.value).toBe("new");
  });

  test("saveFullJar releases the lock when done", async () => {
    writeJar("p", [cookie("SID", "old")]);
    const store = fastStore();
    await store.saveFullJar("p", [cookie("SID", "new")]);
    expect(existsSync(lockPathFor("p"))).toBe(false);
  });

  test("writes the Playwright storage-state JSON shape", async () => {
    writeJar("p", [cookie("SID", "old")]);
    const store = fastStore();
    await store.saveFullJar("p", [cookie("SID", "new")]);
    const raw = JSON.parse(readFileSync(join(TEST_DIR, "profiles", "p", "storage_state.json"), "utf-8"));
    expect(Array.isArray(raw.cookies)).toBe(true);
    expect(raw.cookies[0].name).toBe("SID");
  });
});
