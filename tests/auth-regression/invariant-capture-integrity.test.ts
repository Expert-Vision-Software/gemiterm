import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieSession, createCookieSession } from "../../src/auth/cookie-session.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";
import { SessionClassifier } from "../../src/auth/session-classifier.ts";
import { RecoveryRung } from "../../src/auth/recovery.ts";
import { BrowserRefresher } from "../../src/auth/browser-refresher.ts";
import { PlaywrightCliDriver } from "../../src/services/playwright-cli-driver.ts";
import { freshFullJar, staleFullJar, phantomShapedJar, deadJar, trimmedFourCookieJar } from "./fixtures.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-auth-regression");

let logs: string[] = [];
const origLog = console.log;

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "profiles"), { recursive: true });
  logs = [];
  console.log = ((...args: unknown[]) => { logs.push(args.map(String).join(" ")); }) as typeof console.log;
});

afterEach(() => {
  console.log = origLog;
  delete process.env.GEMITERM_CONFIG_DIR;
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe("auth-regression: full-jar capture integrity", () => {
  test("capture persists every offered cookie; no name-subset filter can reduce it", async () => {
    const fullJar = freshFullJar();
    const capturedCookies: Cookie[] = [];
    
    const driver = {
      openHeaded: mock(async () => {}),
      openHeadless: mock(async () => {}),
      cookieList: mock(async () => fullJar),
      cookieListFromState: mock(async () => fullJar),
      closeSession: mock(async () => {}),
    };

    const cookieStore = new CookieStore();
    const originalSave = cookieStore.saveFullJar.bind(cookieStore);
    
    cookieStore.saveFullJar = async (profile, cookies, snapshot) => {
      capturedCookies.push(...cookies);
      return originalSave(profile, cookies, snapshot);
    };

    const deps = {
      cookieStore,
      validator: new CookieValidator({ logger: makeLogger() as never }),
      refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
      cooldown: new RotationCooldown(),
      classifier: {
        classify: mock(async () => "live" as const),
        classifyDetailed: mock(async () => ({ state: "live" as const, chatCount: 1 })),
      },
      recovery: { recover: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts", cookies: fullJar })) },
      logger: makeLogger(),
      spawnRefreshRunner: mock(() => {}),
      listProfiles: mock(async () => ["p"]),
      conversationLookup: { profileHasConversation: mock(async () => false) },
      driver,
      pollIntervalMs: 5,
    };

    const session = new CookieSession(deps as never);
    await session.captureLogin("test-profile");

    expect(capturedCookies.length).toBe(fullJar.length);
    
    const capturedNames = new Set(capturedCookies.map((c) => c.name));
    const offeredNames = new Set(fullJar.map((c) => c.name));
    
    expect(capturedNames.size).toBe(offeredNames.size);
    offeredNames.forEach((name) => {
      expect(capturedNames.has(name)).toBe(true);
    });
    
    const diskJar = await cookieStore.load("test-profile");
    expect(diskJar.cookies.length).toBe(fullJar.length);
  });

  test("trimmed 4-cookie jar is captured as-is (historical artifact preservation)", async () => {
    const trimmedJar = trimmedFourCookieJar();
    const capturedCookies: Cookie[] = [];
    
    const driver = {
      openHeaded: mock(async () => {}),
      openHeadless: mock(async () => {}),
      cookieList: mock(async () => trimmedJar),
      cookieListFromState: mock(async () => trimmedJar),
      closeSession: mock(async () => {}),
    };

    const cookieStore = new CookieStore();
    const originalSave = cookieStore.saveFullJar.bind(cookieStore);
    
    cookieStore.saveFullJar = async (profile, cookies, snapshot) => {
      capturedCookies.push(...cookies);
      return originalSave(profile, cookies, snapshot);
    };

    const deps = {
      cookieStore,
      validator: new CookieValidator({ logger: makeLogger() as never }),
      refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
      cooldown: new RotationCooldown(),
      classifier: {
        classify: mock(async () => "live" as const),
        classifyDetailed: mock(async () => ({ state: "live" as const, chatCount: 1 })),
      },
      recovery: { recover: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts", cookies: trimmedJar })) },
      logger: makeLogger(),
      spawnRefreshRunner: mock(() => {}),
      listProfiles: mock(async () => ["p"]),
      conversationLookup: { profileHasConversation: mock(async () => false) },
      driver,
      pollIntervalMs: 5,
    };

    const session = new CookieSession(deps as never);
    await session.captureLogin("test-profile");

    expect(capturedCookies.length).toBe(trimmedJar.length);
    const diskJar = await cookieStore.load("test-profile");
    expect(diskJar.cookies.length).toBe(trimmedJar.length);
  });
});

describe("auth-regression: PSIDTS rotation propagation", () => {
  test("store save propagates new PSIDTS value to disk", async () => {
    const initialJar = freshFullJar();
    const rotatedJar = freshFullJar();
    const newPsidtsValue = "rotated-psidts-" + Date.now();
    
    rotatedJar.forEach(c => {
      if (c.name === "__Secure-1PSIDTS") {
        c.value = newPsidtsValue;
      }
    });
    
    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", rotatedJar, new Map());

    const diskJar = await cookieStore.load("test-profile");
    const psidtsCookie = diskJar.cookies.find(c => c.name === "__Secure-1PSIDTS");
    expect(psidtsCookie?.value).toBe(newPsidtsValue);
  });

  test("recovery rung propagates new PSIDTS value to disk", async () => {
    const deadJarLocal = deadJar();
    const recoveredJar = freshFullJar();
    const newPsidtsValue = "recovered-psidts-" + Date.now();
    
    recoveredJar.forEach(c => {
      if (c.name === "__Secure-1PSIDTS") {
        c.value = newPsidtsValue;
      }
    });
    
    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", deadJarLocal, new Map());
    await cookieStore.saveFullJar("test-profile", recoveredJar, new Map());

    const diskJar = await cookieStore.load("test-profile");
    const psidtsCookie = diskJar.cookies.find(c => c.name === "__Secure-1PSIDTS");
    expect(psidtsCookie?.value).toBe(newPsidtsValue);
  });
});

describe("auth-regression: signed-out capture safety", () => {
  test("no write on anonymous-cookie capture (no init tokens)", async () => {
    const anonymousJar = [
      { name: "CONSENT", value: "YES", domain: ".google.com", path: "/", expires: Date.now() / 1000 + 86400, httpOnly: false, secure: true, sameSite: "Lax" as const },
    ];
    
    const driver = {
      openHeaded: mock(async () => {}),
      openHeadless: mock(async () => {}),
      cookieList: mock(async () => anonymousJar),
      cookieListFromState: mock(async () => anonymousJar),
      closeSession: mock(async () => {}),
    };

    const cookieStore = new CookieStore();
    let saveCalls = 0;
    const originalSave = cookieStore.saveFullJar.bind(cookieStore);
    cookieStore.saveFullJar = async (profile, cookies) => {
      saveCalls++;
      return originalSave(profile, cookies);
    };

    const deps = {
      cookieStore,
      validator: new CookieValidator({ logger: makeLogger() as never }),
      refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
      cooldown: new RotationCooldown(),
      classifier: {
        classify: mock(async () => "dead" as const),
        classifyDetailed: mock(async () => ({ state: "dead" as const, chatCount: 0 })),
      },
      recovery: { recover: mock(async () => { throw new Error("Should not recover"); }) },
      logger: makeLogger(),
      spawnRefreshRunner: mock(() => {}),
      listProfiles: mock(async () => []),
      conversationLookup: { profileHasConversation: mock(async () => false) },
      driver,
      pollIntervalMs: 5,
    };

    const session = new CookieSession(deps as never);
    
    await expect(session.captureLogin("test-profile", { timeoutMs: 50 })).rejects.toThrow();
    expect(saveCalls).toBe(0);
    expect(driver.cookieListFromState).not.toHaveBeenCalled();
  });

  test("pre-existing jar is left unchanged on signed-out capture attempt", async () => {
    const existingJar = freshFullJar();
    const anonymousJar = [
      { name: "CONSENT", value: "YES", domain: ".google.com", path: "/", expires: Date.now() / 1000 + 86400, httpOnly: false, secure: true, sameSite: "Lax" as const },
    ];
    
    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", existingJar, new Map());
    
    const jarPath = join(TEST_DIR, "profiles", "test-profile", "storage_state.json");
    const bytesBefore = readFileSync(jarPath, "utf-8");

    const driver = {
      openHeaded: mock(async () => {}),
      openHeadless: mock(async () => {}),
      cookieList: mock(async () => anonymousJar),
      cookieListFromState: mock(async () => anonymousJar),
      closeSession: mock(async () => {}),
    };

    const deps = {
      cookieStore,
      validator: new CookieValidator({ logger: makeLogger() as never }),
      refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
      cooldown: new RotationCooldown(),
      classifier: {
        classify: mock(async () => "dead" as const),
        classifyDetailed: mock(async () => ({ state: "dead" as const, chatCount: 0 })),
      },
      recovery: { recover: mock(async () => { throw new Error("Should not recover"); }) },
      logger: makeLogger(),
      spawnRefreshRunner: mock(() => {}),
      listProfiles: mock(async () => ["p"]),
      conversationLookup: { profileHasConversation: mock(async () => false) },
      driver,
      pollIntervalMs: 5,
    };

    const session = new CookieSession(deps as never);
    
    await expect(session.captureLogin("test-profile", { timeoutMs: 50 })).rejects.toThrow();
    
    expect(readFileSync(jarPath, "utf-8")).toBe(bytesBefore);
  });
});