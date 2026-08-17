// Invariant: validator tier-1/tier-2 contract (#2061 class, fix-4 task 2.5).
// tier-1 raises on absent __Secure-1PSID / absent or non-routable PSIDTS;
// tier-2 warns once on a companion-less jar.
import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";
import { COMPANION_COOKIE_NAMES } from "../../src/auth/auth-constants.ts";
import { freshFullJar } from "./fixtures.ts";
import { setupIsolation, teardownIsolation, withPsidts, makeLogger } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

function validatorWithWarnLog() {
  const warnCalls: string[] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock((msg: string) => void warnCalls.push(msg)),
    error: mock(() => {}),
  };
  return { validator: new CookieValidator({ logger: logger as never }), warnCalls };
}

function withoutAllCompanions() {
  return freshFullJar().filter((c) => !(COMPANION_COOKIE_NAMES as readonly string[]).includes(c.name));
}

function quietValidator() {
  return new CookieValidator({ logger: makeLogger() as never });
}

describe("auth-regression: validator contract", () => {
  test("tier-1 raises on absent __Secure-1PSID", () => {
    const jar = freshFullJar().filter((c) => c.name !== "__Secure-1PSID");
    expect(() => quietValidator().validate(jar)).toThrow(/__Secure-1PSID/);
  });

  test("tier-1 raises on absent __Secure-1PSIDTS", () => {
    const jar = freshFullJar().filter((c) => c.name !== "__Secure-1PSIDTS");
    expect(() => quietValidator().validate(jar)).toThrow(/__Secure-1PSIDTS/);
  });

  test("tier-1 raises on non-routable PSIDTS (wrong scope)", () => {
    const jar = freshFullJar().map((c) => (c.name === "__Secure-1PSIDTS" ? { ...c, domain: ".example.com" } : c));
    expect(() => quietValidator().validate(jar)).toThrow(/routable/);
  });

  test("tier-1 raises on expired PSIDTS", () => {
    const jar = withPsidts(freshFullJar(), "expired-ts").map((c) =>
      c.name === "__Secure-1PSIDTS" ? { ...c, expires: Math.floor(Date.now() / 1000) - 3600 } : c,
    );
    expect(() => quietValidator().validate(jar)).toThrow(/expired|routable/);
  });

  test("tier-2 warns when the jar has no companion cookies at all", () => {
    const { validator, warnCalls } = validatorWithWarnLog();
    validator.validate(withoutAllCompanions());
    expect(warnCalls.length).toBe(1);
    expect(warnCalls[0]).toMatch(/companion/);
  });

  test("tier-2 warns once across repeated validations (warn-once)", () => {
    const { validator, warnCalls } = validatorWithWarnLog();
    const jar = withoutAllCompanions();
    validator.validate(jar);
    validator.validate(jar);
    expect(warnCalls.length).toBe(1);
  });

  test("tier-2 is silent on a full jar", () => {
    const { validator, warnCalls } = validatorWithWarnLog();
    validator.validate(freshFullJar());
    expect(warnCalls.filter((c) => /companion/.test(c)).length).toBe(0);
  });
});