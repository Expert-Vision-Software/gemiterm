import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";
import { freshFullJar, deadJar } from "./fixtures.ts";

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

describe("auth-regression: validator contract", () => {
  test("tier-1 raises on absent __Secure-1PSID", async () => {
    const jarWithoutPsid = freshFullJar().filter(c => c.name !== "__Secure-1PSID");
    const validator = new CookieValidator({ logger: makeLogger() as never });
    
    expect(() => validator.validate(jarWithoutPsid)).toThrow(/__Secure-1PSID/);
  });

  test("tier-1 raises on absent __Secure-1PSIDTS", async () => {
    const jarWithoutPsidts = freshFullJar().filter(c => c.name !== "__Secure-1PSIDTS");
    const validator = new CookieValidator({ logger: makeLogger() as never });
    
    expect(() => validator.validate(jarWithoutPsidts)).toThrow(/__Secure-1PSIDTS/);
  });

  test("tier-1 raises on non-routable PSIDTS (wrong domain)", async () => {
    const jarWithWrongDomain = freshFullJar().map(c => {
      if (c.name === "__Secure-1PSIDTS") {
        return { ...c, domain: ".example.com" };
      }
      return c;
    });
    const validator = new CookieValidator({ logger: makeLogger() as never });
    
    expect(() => validator.validate(jarWithWrongDomain)).toThrow(/routable/);
  });

  test("tier-1 raises on expired PSIDTS", async () => {
    const jarWithExpiredPsidts = freshFullJar().map(c => {
      if (c.name === "__Secure-1PSIDTS") {
        return { ...c, expires: Math.floor(Date.now() / 1000) - 3600 };
      }
      return c;
    });
    const validator = new CookieValidator({ logger: makeLogger() as never });
    
    expect(() => validator.validate(jarWithExpiredPsidts)).toThrow(/expired/);
  });

  test("tier-2 does not warn on full jar with all companions", async () => {
    const fullJar = freshFullJar();
    const warnCalls: string[] = [];
    const logger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock((msg: string) => { warnCalls.push(msg); }),
      error: mock(() => {}),
    };
    
    const validator = new CookieValidator({ logger: logger as never });
    
    validator.validate(fullJar);
    
    const companionWarnings = warnCalls.filter(call => 
      call.includes("companion") || call.includes("SID") || call.includes("HSID")
    );
    expect(companionWarnings.length).toBe(0);
  });
});