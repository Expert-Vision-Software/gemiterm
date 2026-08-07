import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  AuthService,
  AuthServiceTimeoutError,
  mergeCookies,
} from "../../src/services/auth-service.ts";
import { CookieMonitor } from "../../src/services/cookie-monitor.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { _resetRotationStateForTests } from "../../src/services/cookie-rotation.ts";
import * as io from "../../src/infrastructure/io.ts";
import * as elevation from "../../src/infrastructure/elevation.ts";

function createMockDriver() {
  return {
    openHeaded: mock(async (_url: string, _profile: string, _session?: string) => {}),
    openHeadless: mock(async (_url: string, _profile: string, _session?: string) => {}),
    closeSession: mock(async (_session: string) => {}),
    closeAll: mock(async () => {}),
    stateLoad: mock(async (_session: string, _path: string) => {}),
    evalJs: mock(async (_session: string, _expression: string) => ""),
  };
}

function createMockCookieMonitor() {
  return {
    start: mock(
      async (
        _session: string,
        _onCookiesFound: (cookies: Cookie[]) => void,
        _timeoutMs?: number,
      ) => {},
    ),
    stop: mock(() => {}),
    isRunning: false,
  };
}

function createMockCookieStorage() {
  return {
    save: mock((_profileName: string, _cookies: Cookie[]) => {}),
    load: mock((_profileName: string) => [] as Cookie[]),
    delete: mock((_profileName: string) => {}),
    list: mock(() => [] as string[]),
  };
}

function createTestLogger(): Logger {
  const logger = new Logger("test");
  Logger.setVerbose(true);
  return logger;
}

function makeAuthCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "test-psid-value",
      domain: ".google.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "None",
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

function buildService(
  driver: ReturnType<typeof createMockDriver>,
  cookieMonitor: ReturnType<typeof createMockCookieMonitor>,
  cookieStorage: ReturnType<typeof createMockCookieStorage>,
  logger: Logger,
) {
  return new AuthService({
    driver: driver as never,
    cookieMonitor: cookieMonitor as never,
    cookieStorage: cookieStorage as never,
    cookieStorageService: new CookieStorageService({ cookieStorage: cookieStorage as never, logger }) as never,
    logger,
    silentRefreshMonitorFactory: () => cookieMonitor as never,
  });
}

describe("AuthService", () => {
  let driver: ReturnType<typeof createMockDriver>;
  let cookieMonitor: ReturnType<typeof createMockCookieMonitor>;
  let cookieStorage: ReturnType<typeof createMockCookieStorage>;
  let logger: Logger;
  let elevationSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    driver = createMockDriver();
    cookieMonitor = createMockCookieMonitor();
    cookieStorage = createMockCookieStorage();
    logger = createTestLogger();
    elevationSpy = spyOn(elevation, "isRunningElevated").mockReturnValue(false);
  });

  afterEach(() => {
    mock.restore();
    Logger.setVerbose(false);
  });

  describe("authenticate", () => {
    test("completes full auth flow and returns cookies", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.authenticate("test-profile");

      expect(result.cookies).toHaveLength(2);
      expect(result.cookies[0]!.name).toBe("__Secure-1PSID");
      expect(result.expiresAt).not.toBeNull();
      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");
      expect(driver.closeAll).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    test("rejects on timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(
        async () => {
          // never invokes callback -> hard timeout fires
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.waitForLogin("default", 50)).rejects.toBeInstanceOf(
        AuthServiceTimeoutError,
      );
    });

    test("calls closeBrowser in finally even when waitForLogin throws", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const spy = spyOn(svc, "waitForLogin").mockRejectedValueOnce(new Error("boom"));

      await expect(svc.authenticate("test-profile")).rejects.toThrow("boom");
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");
      spy.mockRestore();
    });

    test("throws on invalid profile name", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      await expect(svc.authenticate("bad name!")).rejects.toThrow("invalid characters");
    });
  });

  describe("renew", () => {
    test("pre-loads existing cookies via stateLoad and reloads page", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.renew("test-profile");

      expect(result.cookies).toHaveLength(2);
      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(driver.stateLoad).toHaveBeenCalledTimes(1);
      expect(driver.stateLoad).toHaveBeenCalledWith("test-profile", expect.stringContaining("storage_state.json"));
      expect(driver.evalJs).toHaveBeenCalledTimes(1);
      expect(driver.evalJs).toHaveBeenCalledWith("test-profile", "location.reload()");
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");

      existsSpy.mockRestore();
      logSpy.mockRestore();
    });

    test("skips stateLoad when no existing cookies file", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(false);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      await svc.renew("test-profile");

      expect(driver.stateLoad).not.toHaveBeenCalled();
      expect(driver.evalJs).not.toHaveBeenCalled();
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);

      existsSpy.mockRestore();
      logSpy.mockRestore();
    });

    test("continues gracefully when stateLoad throws", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );
      driver.stateLoad.mockRejectedValueOnce(new Error("state-load failed"));

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.renew("test-profile");

      expect(result.cookies).toHaveLength(2);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);

      existsSpy.mockRestore();
      logSpy.mockRestore();
    });

    test("prints renewal success message", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(false);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      await svc.renew("test-profile");

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Renewing session");
      expect(all).toContain("Session renewed");

      existsSpy.mockRestore();
      logSpy.mockRestore();
    });

    test("calls closeBrowser in finally even when waitForLogin throws", async () => {
      const existsSpy = spyOn(io, "existsFile").mockReturnValue(false);

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const spy = spyOn(svc, "waitForLogin").mockRejectedValueOnce(new Error("boom"));

      await expect(svc.renew("test-profile")).rejects.toThrow("boom");
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");

      spy.mockRestore();
      existsSpy.mockRestore();
    });

    test("throws on invalid profile name", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      await expect(svc.renew("bad name!")).rejects.toThrow("invalid characters");
    });
  });

  describe("elevation guard", () => {
    test("authenticate throws ElevationError when running elevated", async () => {
      elevationSpy.mockReturnValue(true);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.authenticate("test-profile")).rejects.toBeInstanceOf(elevation.ElevationError);
      expect(driver.openHeaded).not.toHaveBeenCalled();
      expect(driver.closeSession).not.toHaveBeenCalled();
    });

    test("renew throws ElevationError when running elevated", async () => {
      elevationSpy.mockReturnValue(true);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.renew("test-profile")).rejects.toBeInstanceOf(elevation.ElevationError);
      expect(driver.openHeaded).not.toHaveBeenCalled();
    });
  });

  describe("notifyUser", () => {
    test("prints the URL and a hint about auto-detection", () => {      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.notifyUser("default");

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Opening headed browser");
      expect(all).toContain("https://gemini.google.com/app");
      expect(all).toContain("auto-detect");
      logSpy.mockRestore();
    });
  });

  describe("launchBrowser", () => {
    test("calls openHeaded with app URL, profile name as both profile and session", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await svc.launchBrowser("my-profile");

      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(driver.openHeaded).toHaveBeenCalledWith(
        "https://gemini.google.com/app",
        "my-profile",
        "my-profile",
      );
    });
  });

  describe("waitForLogin", () => {
    test("resolves with cookies when monitor callback fires", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const cookies = await svc.waitForLogin("default", 60_000);
      expect(cookies).toHaveLength(2);
      expect(cookies[0]!.name).toBe("__Secure-1PSID");
    });

    test("rejects with AuthServiceTimeoutError on hard timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(async () => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.waitForLogin("default", 50)).rejects.toBeInstanceOf(
        AuthServiceTimeoutError,
      );
    });

    test("stops cookie monitor on timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(async () => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      try {
        await svc.waitForLogin("default", 50);
      } catch {
        // expected
      }

      expect(cookieMonitor.stop).toHaveBeenCalled();
    });

    test("does not double-resolve when timeout and callback race", async () => {
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          // schedule callback AND let the timeout race
          setTimeout(() => callback(makeAuthCookies()), 5);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const cookies = await svc.waitForLogin("default", 200);
      expect(cookies).toHaveLength(2);
    });
  });

  describe("extractCookies", () => {
    test("saves cookies via cookieStorage", async () => {
      const cookies = makeAuthCookies();
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await svc.extractCookies("default", cookies);

      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledWith("default", cookies);
    });
  });

  describe("mergeCookies", () => {
    function cookie(name: string, value: string, domain: string, path = "/"): Cookie {
      return {
        name,
        value,
        domain,
        path,
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      };
    }

    test("preserves existing entry when polled set lacks it", () => {
      const existing: Cookie[] = [
        cookie("__Secure-1PSID", "g-psid", ".google.com"),
        cookie("__Secure-1PSIDTS", "g-psidts", ".google.com"),
        cookie("__Secure-1PSID", "yt-psid", ".youtube.com"),
        cookie("__Secure-1PSIDTS", "yt-psidts", ".youtube.com"),
      ];
      const polled: Cookie[] = [
        cookie("__Secure-1PSID", "new-g-psid", ".google.com"),
        cookie("__Secure-1PSIDTS", "new-yt-psidts", ".youtube.com"),
        cookie("__Secure-1PSID", "new-yt-psid", ".youtube.com"),
      ];

      const merged = mergeCookies(existing, polled);

      expect(merged).toHaveLength(4);
      const gPsid = merged.find((c) => c.name === "__Secure-1PSID" && c.domain === ".google.com");
      expect(gPsid?.value).toBe("new-g-psid");
      const gPsidts = merged.find((c) => c.name === "__Secure-1PSIDTS" && c.domain === ".google.com");
      expect(gPsidts).toBeDefined();
      expect(gPsidts?.value).toBe("g-psidts");
    });

    test("overwrites when key matches", () => {
      const existing: Cookie[] = [
        cookie("__Secure-1PSID", "old-value", ".google.com"),
      ];
      const polled: Cookie[] = [
        cookie("__Secure-1PSID", "new-value", ".google.com"),
      ];

      const merged = mergeCookies(existing, polled);

      expect(merged).toHaveLength(1);
      expect(merged[0]!.value).toBe("new-value");
    });

    test("handles empty existing jar", () => {
      const existing: Cookie[] = [];
      const polled: Cookie[] = [
        cookie("__Secure-1PSID", "g-psid", ".google.com"),
        cookie("__Secure-1PSIDTS", "g-psidts", ".google.com"),
      ];

      const merged = mergeCookies(existing, polled);

      expect(merged).toHaveLength(2);
      expect(merged.find((c) => c.name === "__Secure-1PSID")?.value).toBe("g-psid");
      expect(merged.find((c) => c.name === "__Secure-1PSIDTS")?.value).toBe("g-psidts");
    });

    test("adds new polled entries not in existing jar", () => {
      const existing: Cookie[] = [
        cookie("__Secure-1PSID", "g-psid", ".google.com"),
      ];
      const polled: Cookie[] = [
        cookie("__Secure-1PSID", "g-psid", ".google.com"),
        cookie("__Secure-1PSIDTS", "new-psidts", ".google.com"),
      ];

      const merged = mergeCookies(existing, polled);

      expect(merged).toHaveLength(2);
      expect(merged.find((c) => c.name === "__Secure-1PSIDTS")?.value).toBe("new-psidts");
    });
  });

  describe("confirmAuthSuccess", () => {
    test("prints success messages, expiry, and __Secure-1PSID check", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmAuthSuccess(2, new Date("2026-12-31T00:00:00Z"), makeAuthCookies());

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Login auto-detected");
      expect(all).toContain("Authentication successful");
      expect(all).toContain("2 cookies");
      expect(all).toContain("Session expires");
      expect(all).toContain("__Secure-1PSID");
      logSpy.mockRestore();
    });

    test("prints success without expiry when expiresAt is null", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmAuthSuccess(1, null, []);

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Authentication successful");
      expect(all).toContain("1 cookies");
      expect(all).not.toContain("Session expires");
      logSpy.mockRestore();
    });

    test("indicates missing __Secure-1PSID cookie when absent", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmAuthSuccess(0, null, []);

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("__Secure-1PSID");
      expect(all).toContain("❌");
      logSpy.mockRestore();
    });
  });

  describe("confirmRenewSuccess", () => {
    test("prints renewal success messages, expiry, and __Secure-1PSID check", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmRenewSuccess(2, new Date("2026-12-31T00:00:00Z"), makeAuthCookies());

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Session renewed");
      expect(all).toContain("Renewal successful");
      expect(all).toContain("2 cookies");
      expect(all).toContain("Session expires");
      expect(all).toContain("__Secure-1PSID");
      logSpy.mockRestore();
    });
  });

  describe("closeBrowser", () => {
    test("calls closeSession on the driver with the profile name", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await svc.closeBrowser("default");

      expect(driver.closeSession).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledWith("default");
    });

    test("does not throw when closeSession fails", async () => {
      driver.closeSession.mockRejectedValueOnce(new Error("browser already closed"));

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.closeBrowser("default")).resolves.toBeUndefined();
    });
  });

  describe("silentRefresh", () => {
    test("launches headless browser, loads state, and returns true on monitor success", async () => {
      cookieStorage.load.mockReturnValue(makeAuthCookies());
      cookieMonitor.start.mockImplementationOnce(async (_session, callback) => {
        callback(makeAuthCookies().map((c) => c.name === "__Secure-1PSIDTS" ? { ...c, value: "rotated-psidts" } : c));
      });

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(true);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
      expect(driver.openHeadless).toHaveBeenCalledWith(
        "https://gemini.google.com/app",
        "test-profile",
        "test-profile",
      );
      expect(driver.stateLoad).toHaveBeenCalledTimes(1);
      expect(driver.stateLoad).toHaveBeenCalledWith(
        "test-profile",
        expect.stringContaining("storage_state.json"),
      );
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      const startArgs = cookieMonitor.start.mock.calls[0]!;
      expect(startArgs[0]).toBe("test-profile");
      expect(startArgs[2]).toBe(30_000);
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");

      existsSpy.mockRestore();
    });

    test("returns false on cookie-monitor timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(async () => {});

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      const result = await svc.silentRefresh("test-profile", { timeoutMs: 50 });

      expect(result).toBe(false);
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      const startArgs = cookieMonitor.start.mock.calls[0]!;
      expect(startArgs[2]).toBe(50);
      expect(cookieMonitor.stop).toHaveBeenCalled();
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");

      existsSpy.mockRestore();
    });

    test("returns false when openHeadless throws", async () => {
      driver.openHeadless.mockRejectedValueOnce(new Error("browser failed to launch"));

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(false);
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");
      expect(cookieMonitor.start).not.toHaveBeenCalled();

      existsSpy.mockRestore();
    });

    test("returns false when no saved cookies file exists", async () => {
      const existsSpy = spyOn(io, "existsFile").mockReturnValue(false);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      const result = await svc.silentRefresh("new-profile");

      expect(result).toBe(false);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
      expect(driver.stateLoad).not.toHaveBeenCalled();
      expect(cookieMonitor.start).not.toHaveBeenCalled();
      expect(driver.closeSession).toHaveBeenCalledWith("new-profile");

      existsSpy.mockRestore();
    });

    test("returns false when stateLoad fails", async () => {
      driver.stateLoad.mockRejectedValueOnce(new Error("state-load failed"));
      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(false);
      expect(cookieMonitor.start).not.toHaveBeenCalled();
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");

      existsSpy.mockRestore();
    });

    test("does not print to stdout", async () => {
      cookieMonitor.start.mockImplementationOnce(async (_session, callback) => {
        callback(makeAuthCookies());
      });

      const existsSpy = spyOn(io, "existsFile").mockReturnValue(true);
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      await svc.silentRefresh("test-profile");

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
      existsSpy.mockRestore();
    });

    test("returns false on invalid profile name (never throws)", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("bad name!");
      expect(result).toBe(false);
      expect(driver.openHeadless).not.toHaveBeenCalled();
    });
  });

  describe("silentRefresh L1/L2 ladder", () => {
    const originalFetch = globalThis.fetch;
    const originalSkipRotateCookies = process.env.GEMITERM_SKIP_ROTATE_COOKIES;

    function makeRotationCookies(psid: string, psidts: string): Cookie[] {
      return makeAuthCookies().map((cookie) => {
        if (cookie.name === "__Secure-1PSID") {
          return { ...cookie, value: psid };
        }
        if (cookie.name === "__Secure-1PSIDTS") {
          return { ...cookie, value: psidts };
        }
        return cookie;
      });
    }

    beforeEach(() => {
      delete process.env.GEMITERM_SKIP_ROTATE_COOKIES;
      spyOn(io, "existsFile").mockReturnValue(true);
      spyOn(io, "getFileMtime").mockReturnValue(null);
      _resetRotationStateForTests();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      if (originalSkipRotateCookies === undefined) {
        delete process.env.GEMITERM_SKIP_ROTATE_COOKIES;
      } else {
        process.env.GEMITERM_SKIP_ROTATE_COOKIES = originalSkipRotateCookies;
      }
      _resetRotationStateForTests();
    });

    test("L1 succeeds without launching a browser when PSIDTS rotates", async () => {
      const storedCookies = makeRotationCookies("active-psid", "old-psidts");
      cookieStorage.load.mockReturnValue(storedCookies);
      globalThis.fetch = mock(
        async () =>
          new Response(null, {
            status: 200,
            headers: {
              "set-cookie":
                "__Secure-1PSIDTS=new-psidts; Domain=.google.com; Path=/",
            },
          }),
      ) as unknown as typeof fetch;

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(true);
      expect(driver.openHeadless).not.toHaveBeenCalled();
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      const saveCall = cookieStorage.save.mock.calls[0]!;
      expect(saveCall[0]).toBe("test-profile");
      expect(
        saveCall[1].find((cookie) => cookie.name === "__Secure-1PSIDTS")?.value,
      ).toBe("new-psidts");
    });

    test("falls through to L2 and succeeds when L1 has a network error", async () => {
      const storedCookies = makeRotationCookies("active-psid", "active-psidts");
      const rotatedCookies = makeRotationCookies("new-psid", "new-psidts");
      cookieStorage.load.mockReturnValue(storedCookies);
      globalThis.fetch = mock(async () => {
        throw new Error("network error");
      }) as unknown as typeof fetch;
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(rotatedCookies);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(true);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save.mock.calls[0]![0]).toBe("test-profile");
      expect(cookieStorage.save.mock.calls[0]![1]).toEqual(rotatedCookies);
    });

    test("returns false when L2 cookies are identical to the snapshot", async () => {
      const storedCookies = makeRotationCookies("active-psid", "active-psidts");
      cookieStorage.load.mockReturnValue(storedCookies);
      globalThis.fetch = mock(async () => {
        throw new Error("network error");
      }) as unknown as typeof fetch;
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(makeRotationCookies("active-psid", "active-psidts"));
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(false);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).not.toHaveBeenCalled();
    });

    test("falls through to L2 when L1 returns an unchanged PSIDTS", async () => {
      const storedCookies = makeRotationCookies("active-psid", "active-psidts");
      const rotatedCookies = makeRotationCookies("new-psid", "new-psidts");
      cookieStorage.load.mockReturnValue(storedCookies);
      globalThis.fetch = mock(
        async () =>
          new Response(null, {
            status: 200,
            headers: {
              "set-cookie":
                "__Secure-1PSIDTS=active-psidts; Domain=.google.com; Path=/",
            },
          }),
      ) as unknown as typeof fetch;
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(rotatedCookies);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(true);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save.mock.calls[0]![1]).toEqual(rotatedCookies);
    });

    test("falls through to L2 and succeeds when L1 returns 401", async () => {
      const storedCookies = makeRotationCookies("active-psid", "active-psidts");
      const rotatedCookies = makeRotationCookies("new-psid", "new-psidts");
      cookieStorage.load.mockReturnValue(storedCookies);
      globalThis.fetch = mock(
        async () => new Response(null, { status: 401 }),
      ) as unknown as typeof fetch;
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(rotatedCookies);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(true);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
    });

    test("skips L1 and reaches L2 when GEMITERM_SKIP_ROTATE_COOKIES is set", async () => {
      const storedCookies = makeRotationCookies("active-psid", "active-psidts");
      const rotatedCookies = makeRotationCookies("new-psid", "new-psidts");
      const fetchMock = mock(async () => new Response(null, { status: 500 }));
      process.env.GEMITERM_SKIP_ROTATE_COOKIES = "1";
      cookieStorage.load.mockReturnValue(storedCookies);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(rotatedCookies);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile");

      expect(result).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
    });

    test("L2 snapshot strict filter rejects evilgoogle.com; fallback catches by name", async () => {
      const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const spoofedCookies: Cookie[] = [
        {
          name: "__Secure-1PSID",
          value: "spoofed-psid",
          domain: "evilgoogle.com",
          path: "/",
          expires: farFuture,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "spoofed-psidts",
          domain: "evilgoogle.com",
          path: "/",
          expires: farFuture,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ];
      cookieStorage.load.mockReturnValue(spoofedCookies);
      globalThis.fetch = mock(async () => {
        throw new Error("network error");
      }) as unknown as typeof fetch;
      cookieMonitor.start.mockImplementationOnce(async () => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.silentRefresh("test-profile", { timeoutMs: 50 });

      expect(result).toBe(false);
      expect(driver.openHeadless).toHaveBeenCalledTimes(1);
      const monitorCall = cookieMonitor.start.mock.calls[0];
      expect(monitorCall).toBeDefined();
      const requireRotationArg = monitorCall?.[3] as { activePsid: string; activePsidts: string | null } | undefined;
      expect(requireRotationArg?.activePsid).toBe("spoofed-psid");
      expect(requireRotationArg?.activePsidts).toBe("spoofed-psidts");
    });
  });
});