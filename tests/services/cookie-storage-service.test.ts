import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";

function makeFreshCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "fresh-psid",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "fresh-psidts",
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

function makeStaleCookies(): Cookie[] {
  const soon = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "stale-psid",
      domain: ".google.com",
      path: "/",
      expires: soon,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "stale-psidts",
      domain: ".google.com",
      path: "/",
      expires: soon,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function makePartialCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "only-psid",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function createMockCookieStorage(): CookieStorage {
  return {
    save: mock(async (_profileName: string, _cookies: Cookie[]) => {}),
    load: mock(async (_profileName: string) => [] as Cookie[]),
    delete: mock(async (_profileName: string) => {}),
    list: mock(async () => [] as string[]),
  } as unknown as CookieStorage;
}

describe("CookieStorageService", () => {
  let storage: CookieStorage;
  let service: CookieStorageService;
  let logger: Logger;

  beforeEach(() => {
    storage = createMockCookieStorage();
    logger = new Logger("test");
    service = new CookieStorageService({ cookieStorage: storage, logger });
  });

  afterEach(() => {
    mock.restore();
  });

  describe("loadCookiesForProfile", () => {
    test("returns cookie values from profile", async () => {
      storage.load = mock(async () => makeFreshCookies()) as CookieStorage["load"];

      const result = await service.loadCookiesForProfile("default");
      expect(result.secure_1psid).toBe("fresh-psid");
      expect(result.secure_1psidts).toBe("fresh-psidts");
    });

    test("returns null for 1PSIDTS when missing", async () => {
      storage.load = mock(async () => makePartialCookies()) as CookieStorage["load"];

      const result = await service.loadCookiesForProfile("default");
      expect(result.secure_1psid).toBe("only-psid");
      expect(result.secure_1psidts).toBeNull();
    });

    test("throws when __Secure-1PSID is missing", async () => {
      storage.load = mock(async () => [
        {
          name: "__Secure-1PSIDTS",
          value: "no-psid",
          domain: ".google.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]) as CookieStorage["load"];

      await expect(service.loadCookiesForProfile("default")).rejects.toThrow("Missing required cookie");
    });
  });

  describe("validateCookies", () => {
    test("returns true when both required cookies present", () => {
      expect(service.validateCookies(makeFreshCookies())).toBe(true);
    });

    test("returns false when __Secure-1PSIDTS is missing", () => {
      expect(service.validateCookies(makePartialCookies())).toBe(false);
    });

    test("returns false for empty array", () => {
      expect(service.validateCookies([])).toBe(false);
    });
  });

  describe("checkCookieFreshness", () => {
    test("returns true when cookies expire far in the future", () => {
      expect(service.checkCookieFreshness(makeFreshCookies())).toBe(true);
    });

    test("returns false when cookies are expired", () => {
      expect(service.checkCookieFreshness(makeExpiredCookies())).toBe(false);
    });

    test("returns false when cookies expire within 7 days", () => {
      expect(service.checkCookieFreshness(makeStaleCookies())).toBe(false);
    });

    test("returns true when 1PSIDTS is a session cookie (expires: -1)", () => {
      const sessionCookies: Cookie[] = [
        {
          name: "__Secure-1PSID",
          value: "sid",
          domain: ".google.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "sidts",
          domain: ".google.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ];
      expect(service.checkCookieFreshness(sessionCookies)).toBe(true);
    });
  });

  describe("getCookieExpiry", () => {
    test("returns Date for valid expiry", () => {
      const result = service.getCookieExpiry(makeFreshCookies());
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(Date.now());
    });

    test("returns null when __Secure-1PSIDTS has no positive expires", () => {
      const noExpiry = makePartialCookies();
      expect(service.getCookieExpiry(noExpiry)).toBeNull();
    });

    test("returns null for empty cookies", () => {
      expect(service.getCookieExpiry([])).toBeNull();
    });
  });
});

describe("CookieStorageService persistence seams", () => {
  let storage: CookieStorage;
  let service: CookieStorageService;

  beforeEach(() => {
    storage = createMockCookieStorage();
    service = new CookieStorageService({ cookieStorage: storage, logger: new Logger("test") });
  });

  afterEach(() => {
    mock.restore();
  });

  test("saveCookiesForProfile delegates profile name and cookies to storage.save", async () => {
    const cookies = makeFreshCookies();
    await service.saveCookiesForProfile("default", cookies);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledWith("default", cookies);
  });

  test("loadAllCookiesForProfile delegates to storage.load and returns the raw cookie list", async () => {
    const cookies = makeFreshCookies();
    storage.load = mock(async () => cookies) as CookieStorage["load"];
    expect(await service.loadAllCookiesForProfile("default")).toBe(cookies);
    expect(storage.load).toHaveBeenCalledWith("default");
  });
});