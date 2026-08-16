import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";
import { SessionClassifier } from "../../src/auth/session-classifier.ts";
import { RecoveryRung } from "../../src/auth/recovery.ts";
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

describe("auth-regression: CAS semantics (stale in-memory jar cannot clobber fresher disk jar)", () => {
  test("stale process cannot clobber a sibling's fresh rotation", async () => {
    const initialJar = freshFullJar();
    const freshJar = freshFullJar();
    const newPsidtsValue = "fresh-psidts-" + Date.now();
    
    freshJar.forEach(c => {
      if (c.name === "__Secure-1PSIDTS") {
        c.value = newPsidtsValue;
      }
    });

    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", initialJar, new Map());
    
    const staleProcess = await cookieStore.load("test-profile");
    
    await cookieStore.saveFullJar("test-profile", freshJar, new Map());
    
    await cookieStore.save("test-profile", staleProcess.cookies, staleProcess.snapshot);

    const finalJar = await cookieStore.load("test-profile");
    const psidtsCookie = finalJar.cookies.find(c => c.name === "__Secure-1PSIDTS");
    expect(psidtsCookie?.value).toBe(newPsidtsValue);
  });

  test("CAS preserves unmodified cookies even when some changed", async () => {
    const initialJar = freshFullJar();
    const modifiedJar = freshFullJar();
    const newPsidtsValue = "modified-psidts-" + Date.now();
    const newSidValue = "modified-sid-" + Date.now();
    
    modifiedJar.forEach(c => {
      if (c.name === "__Secure-1PSIDTS") {
        c.value = newPsidtsValue;
      }
      if (c.name === "SID") {
        c.value = newSidValue;
      }
    });

    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", initialJar, new Map());
    
    const staleProcess = await cookieStore.load("test-profile");
    
    const siblingJar = freshFullJar();
    const siblingPsidtsValue = "sibling-psidts-" + Date.now();
    siblingJar.forEach(c => {
      if (c.name === "__Secure-1PSIDTS") {
        c.value = siblingPsidtsValue;
      }
    });
    
    await cookieStore.saveFullJar("test-profile", siblingJar, new Map());
    
    await cookieStore.save("test-profile", modifiedJar, staleProcess.snapshot);

    const finalJar = await cookieStore.load("test-profile");
    const psidtsCookie = finalJar.cookies.find(c => c.name === "__Secure-1PSIDTS");
    const sidCookie = finalJar.cookies.find(c => c.name === "SID");
    
    expect(psidtsCookie?.value).toBe(siblingPsidtsValue);
    expect(sidCookie?.value).toBe(newSidValue);
  });
});