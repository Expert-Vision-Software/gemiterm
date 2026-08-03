import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CookieStorage, ProfileManager } from "../../src/infrastructure/storage.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { rotateCookies, _resetInFlightRotationsForTests } from "../../src/services/cookie-rotation.ts";
import { getProfilePath } from "../../src/infrastructure/path-utils.ts";
import type { Cookie } from "../../src/core/types.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-cookie-rotation");

function makeGoogleCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "psid-val",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "ts-val",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function makeNonGoogleCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "session",
      value: "abc",
      domain: ".example.com",
      path: "/",
      expires: farFuture,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function successResponse(): Response {
  return new Response("", {
    status: 200,
    headers: { "set-cookie": "__Secure-1PSIDTS=NEW-ts; Path=/; Secure" },
  });
}

describe("rotateCookies", () => {
  let storage: CookieStorage;
  let logger: Logger;

  beforeEach(() => {
    process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    storage = new CookieStorage();
    new ProfileManager(storage).create("p");
    logger = new Logger("test");
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.GEMITERM_CONFIG_DIR;
    delete process.env.GEMITERM_SKIP_ROTATE_COOKIES;
    _resetInFlightRotationsForTests();
    mock.restore();
  });

  function prepareProfile(cookies: Cookie[]): void {
    storage.save("p", cookies);
    const profilePath = getProfilePath("p");
    const past = new Date(Date.now() - 700_000);
    utimesSync(profilePath, past, past);
  }

  test("succeeds with fresh PSIDTS: saves cookies and returns true", async () => {
    prepareProfile(makeGoogleCookies());

    const fetcher = mock(async () => successResponse());
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(result).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved = saveSpy.mock.calls[0]?.[1] as Cookie[];
    const savedTs = saved.find((c) => c.name === "__Secure-1PSIDTS");
    expect(savedTs?.value).toBe("NEW-ts");
  });

  test("401 response returns false and does not save", async () => {
    prepareProfile(makeGoogleCookies());

    const fetcher = mock(async () => new Response("unauthorized", { status: 401 }));
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("same PSIDTS in response returns false and does not save", async () => {
    prepareProfile(makeGoogleCookies());

    const fetcher = mock(async () => new Response("", {
      status: 200,
      headers: { "set-cookie": "__Secure-1PSIDTS=ts-val; Path=/; Secure" },
    }));
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("network error returns false and does not save", async () => {
    prepareProfile(makeGoogleCookies());

    const fetcher = mock(async () => {
      throw new Error("network down");
    });
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("GEMITERM_SKIP_ROTATE_COOKIES=1 returns false without calling fetcher", async () => {
    process.env.GEMITERM_SKIP_ROTATE_COOKIES = "1";
    prepareProfile(makeGoogleCookies());

    const fetcher = mock(async () => successResponse());
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("disk-mtime guard fires when storage_state.json mtime is within 600s", async () => {
    storage.save("p", makeGoogleCookies());

    const profilePath = getProfilePath("p");
    const nowDate = new Date();
    utimesSync(profilePath, nowDate, nowDate);

    const fetcher = mock(async () => successResponse());
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
      now: () => nowDate.getTime(),
    });

    expect(result).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("in-process throttle: two concurrent calls trigger only one HTTP request", async () => {
    prepareProfile(makeGoogleCookies());

    const fetcher = mock(async () => successResponse());
    const saveSpy = spyOn(storage, "save");

    const [r1, r2] = await Promise.all([
      rotateCookies("p", {
        cookieStorage: storage,
        logger,
        fetcher: fetcher as unknown as typeof fetch,
      }),
      rotateCookies("p", {
        cookieStorage: storage,
        logger,
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  test("no .google.com cookies stored does not call fetcher", async () => {
    prepareProfile(makeNonGoogleCookies());

    const fetcher = mock(async () => successResponse());
    const saveSpy = spyOn(storage, "save");

    const result = await rotateCookies("p", {
      cookieStorage: storage,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
