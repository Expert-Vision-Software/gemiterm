import { describe, test, expect, mock } from "bun:test";
import type { Cookie } from "../../src/core/types.ts";
import { CookieValidator, isRoutableTo, findRoutableCookieValue } from "../../src/auth/cookie-validation.ts";
import { SessionValidationError } from "../../src/core/errors.ts";

function cookie(overrides: Partial<Cookie> & { name: string }): Cookie {
  return {
    value: "v",
    domain: ".google.com",
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...overrides,
  };
}

function validPair(): Cookie[] {
  return [
    cookie({ name: "__Secure-1PSID" }),
    cookie({ name: "__Secure-1PSIDTS" }),
  ];
}

function fullJar(): Cookie[] {
  return [
    ...validPair(),
    ...["SID", "HSID", "SSID", "APISID", "SAPISID", "SIDCC", "NID"].map((name) => cookie({ name })),
  ];
}

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe("isRoutableTo", () => {
  const target = "https://gemini.google.com/app";

  test("parent domain with root path is routable", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: ".google.com", path: "/" }), target)).toBe(true);
  });

  test("host-only domain is routable", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: "gemini.google.com", path: "/" }), target)).toBe(true);
  });

  test("subdomain scope is routable to parent host", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: ".google.com", path: "/app" }), target)).toBe(true);
  });

  test("wrong domain scope is not routable", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: ".youtube.com", path: "/" }), target)).toBe(false);
  });

  test("sibling domain is not routable", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: "gemini.google.co.uk", path: "/" }), target)).toBe(false);
  });

  test("non-matching path is not routable", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: ".google.com", path: "/accounts" }), target)).toBe(false);
  });

  test("expired cookie is not routable", () => {
    expect(
      isRoutableTo(
        cookie({ name: "X", domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) - 10 }),
        target,
      ),
    ).toBe(true === false);
  });

  test("session cookie (expires -1) is routable", () => {
    expect(isRoutableTo(cookie({ name: "X", domain: ".google.com", path: "/", expires: -1 }), target)).toBe(true);
  });
});

describe("findRoutableCookieValue", () => {
  const target = "https://gemini.google.com/app";

  test("prefers the cookie routable to the target over an earlier same-name sibling", () => {
    const jar = [
      cookie({ name: "__Secure-1PSID", domain: ".youtube.com", value: "yt-psid" }),
      cookie({ name: "__Secure-1PSID", domain: ".google.com", value: "g-psid" }),
    ];
    expect(findRoutableCookieValue(jar, "__Secure-1PSID", target)).toBe("g-psid");
  });

  test("prefers the routable cookie even when it appears later in the jar", () => {
    const jar = [
      cookie({ name: "__Secure-1PSIDTS", domain: ".youtube.com", value: "yt-ts" }),
      cookie({ name: "__Secure-1PSIDTS", domain: ".google.com", value: "g-ts" }),
    ];
    expect(findRoutableCookieValue(jar, "__Secure-1PSIDTS", target)).toBe("g-ts");
  });

  test("falls back to the first name match when none is routable", () => {
    const jar = [cookie({ name: "X", domain: ".youtube.com", value: "yt" })];
    expect(findRoutableCookieValue(jar, "X", target)).toBe("yt");
  });

  test("returns null when the name is absent", () => {
    expect(findRoutableCookieValue([], "__Secure-1PSID", target)).toBeNull();
  });
});

describe("CookieValidator tier 1", () => {
  test("passes a full routable jar", () => {
    const logger = makeLogger();
    const validator = new CookieValidator({ logger });
    expect(() => validator.validate(fullJar())).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("raises on missing PSIDTS", () => {
    const validator = new CookieValidator({ logger: makeLogger() });
    expect(() => validator.validate([cookie({ name: "__Secure-1PSID" })])).toThrow(SessionValidationError);
  });

  test("raises on present-but-unroutable PSIDTS (wrong domain scope)", () => {
    const validator = new CookieValidator({ logger: makeLogger() });
    const jar = [
      cookie({ name: "__Secure-1PSID" }),
      cookie({ name: "__Secure-1PSIDTS", domain: ".youtube.com" }),
    ];
    expect(() => validator.validate(jar)).toThrow(SessionValidationError);
  });

  test("raises on present-but-unroutable PSIDTS (wrong path scope)", () => {
    const validator = new CookieValidator({ logger: makeLogger() });
    const jar = [
      cookie({ name: "__Secure-1PSID" }),
      cookie({ name: "__Secure-1PSIDTS", path: "/accounts" }),
    ];
    expect(() => validator.validate(jar)).toThrow(SessionValidationError);
  });

  test("raises on expired PSIDTS", () => {
    const validator = new CookieValidator({ logger: makeLogger() });
    const jar = [
      cookie({ name: "__Secure-1PSID" }),
      cookie({ name: "__Secure-1PSIDTS", expires: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 }),
    ];
    expect(() => validator.validate(jar)).toThrow(SessionValidationError);
  });

  test("raises on missing PSID", () => {
    const validator = new CookieValidator({ logger: makeLogger() });
    expect(() => validator.validate([cookie({ name: "__Secure-1PSIDTS" })])).toThrow(SessionValidationError);
  });

  test("raises on empty jar", () => {
    const validator = new CookieValidator({ logger: makeLogger() });
    expect(() => validator.validate([])).toThrow(SessionValidationError);
  });
});

describe("CookieValidator tier 2", () => {
  test("warns exactly once for a companion-less jar across repeated validations", () => {
    const logger = makeLogger();
    const validator = new CookieValidator({ logger });
    const jar = validPair();
    expect(() => validator.validate(jar)).not.toThrow();
    expect(() => validator.validate(jar)).not.toThrow();
    expect(() => validator.validate(jar)).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("does not warn when companions are present", () => {
    const logger = makeLogger();
    const validator = new CookieValidator({ logger });
    validator.validate(fullJar());
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
