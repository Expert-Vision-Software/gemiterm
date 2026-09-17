import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { BrowserRefresher } from "../../src/auth/browser-refresher.ts";
import { BrowserSignedOutError } from "../../src/core/errors.ts";
import { GEMINI_APP_URL } from "../../src/auth/auth-constants.ts";

function cookie(name: string, value: string, domain = ".google.com"): Cookie {
  return {
    name,
    value,
    domain,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

const BASELINE_JAR = [
  cookie("__Secure-1PSID", "psid"),
  cookie("__Secure-1PSIDTS", "baseline-ts"),
  cookie("SID", "sid"),
  cookie("HSID", "hsid"),
  cookie("APISID", "apisid"),
];

const ROTATED_JAR = [
  ...BASELINE_JAR.map((c) => (c.name === "__Secure-1PSIDTS" ? { ...c, value: "rotated-ts" } : c)),
  cookie("YOUTUBE_PREFS", "yt", ".youtube.com"),
  cookie("ACCOUNTS_COOKIE", "ac", "accounts.google.com"),
  cookie("THIRD_PARTY", "x", ".example.com"),
];

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function makeDriver(pollCookies: Cookie[] | Error) {
  return {
    openHeadless: mock(async () => {}),
    cookieList: mock(async () => {
      if (pollCookies instanceof Error) throw pollCookies;
      return pollCookies;
    }),
    cookieListFromState: mock(async () => ROTATED_JAR),
    closeSession: mock(async () => {}),
  };
}

function makeStore() {
  return {
    saveFullJar: mock(async () => {}),
    load: mock(async () => ({ cookies: BASELINE_JAR, snapshot: new Map() })),
  };
}

function makeRefresher(driver: ReturnType<typeof makeDriver>, store: ReturnType<typeof makeStore>) {
  return new BrowserRefresher({
    driver,
    cookieStore: store as never,
    logger: makeLogger() as never,
    pollIntervalMs: 10,
  });
}

const ANONYMOUS_JAR = [
  cookie("NID", "nid"),
  cookie("_ga", "ga"),
  cookie("COMPASS", "compass"),
];

function makeSequenceDriver(pollResponses: (Cookie[] | Error)[]) {
  let call = 0;
  return {
    openHeadless: mock(async () => {}),
    cookieList: mock(async () => {
      const response = pollResponses[Math.min(call, pollResponses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return response;
    }),
    cookieListFromState: mock(async () => ROTATED_JAR),
    closeSession: mock(async () => {}),
  };
}

describe("BrowserRefresher.rotatePsidts", () => {
  test("rotation detected: persists full filtered jar and reports rotated:true", async () => {
    const driver = makeDriver(ROTATED_JAR);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", "baseline-ts");

    expect(result.rotated).toBe(true);
    expect(driver.openHeadless).toHaveBeenCalledWith(GEMINI_APP_URL, "p", expect.any(String));
    expect(driver.openHeadless.mock.calls[0]![2]).not.toContain("--headed");
    expect(store.saveFullJar).toHaveBeenCalledTimes(1);

    const [profile, saved] = store.saveFullJar.mock.calls[0] as [string, Cookie[]];
    expect(profile).toBe("p");
    const names = saved.map((c) => c.name);
    expect(names).toContain("__Secure-1PSIDTS");
    expect(names).toContain("__Secure-1PSID");
    expect(names).toContain("SID");
    expect(names).toContain("HSID");
    expect(names).toContain("APISID");
  });

  test("timeout closes the browser, persists nothing, reports rotated:false", async () => {
    const driver = makeDriver(BASELINE_JAR);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 60);

    expect(result.rotated).toBe(false);
    expect(driver.closeSession).toHaveBeenCalledTimes(1);
    expect(store.saveFullJar).not.toHaveBeenCalled();
    expect(driver.cookieListFromState).not.toHaveBeenCalled();
  });

  test("transient poll errors are tolerated until timeout", async () => {
    const driver = makeDriver(new Error("cli hiccup"));
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 50);

    expect(result.rotated).toBe(false);
    expect(driver.closeSession).toHaveBeenCalledTimes(1);
    expect(store.saveFullJar).not.toHaveBeenCalled();
  });

  test("domain filter keeps .google.com/.youtube.com/accounts.google.com rows only", async () => {
    const driver = makeDriver(ROTATED_JAR);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    await refresher.rotatePsidts("p", "baseline-ts");

    const saved = store.saveFullJar.mock.calls[0]![1] as Cookie[];
    const byDomain = new Set(saved.map((c) => c.domain));
    expect(byDomain.has(".google.com")).toBe(true);
    expect(byDomain.has(".youtube.com")).toBe(true);
    expect(byDomain.has("accounts.google.com")).toBe(true);
    expect(byDomain.has(".example.com")).toBe(false);
    expect(saved.find((c) => c.name === "THIRD_PARTY")).toBeUndefined();
  });

  test("null baseline treats any observed PSIDTS as rotation", async () => {
    const driver = makeDriver(BASELINE_JAR);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", null, 100);

    expect(result.rotated).toBe(true);
    expect(store.saveFullJar).toHaveBeenCalledTimes(1);
  });

  test("closeSession runs even when the browser open fails", async () => {
    const driver = makeDriver(BASELINE_JAR);
    driver.openHeadless.mockImplementation(async () => {
      throw new Error("no playwright-cli");
    });
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    await expect(refresher.rotatePsidts("p", "baseline-ts")).rejects.toThrow(/no playwright-cli/);
    expect(driver.closeSession).toHaveBeenCalledTimes(1);
    expect(store.saveFullJar).not.toHaveBeenCalled();
  });

  test("signed-out browser (no routable PSID/PSIDTS) throws BrowserSignedOutError fast", async () => {
    const driver = makeSequenceDriver([ANONYMOUS_JAR]);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const started = Date.now();
    const err = await refresher.rotatePsidts("p", "baseline-ts", 60_000).catch((e: unknown) => e as Error);
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(BrowserSignedOutError);
    expect(err.message).toMatch(/signed out/);
    expect(err.message).toMatch(/gemiterm auth p\b/);
    expect(driver.cookieList.mock.calls.length).toBeLessThanOrEqual(3);
    expect(elapsed).toBeLessThan(5_000);
    expect(store.saveFullJar).not.toHaveBeenCalled();
    expect(driver.closeSession).toHaveBeenCalledTimes(1);
  });

  test("signed-out streak requires two consecutive anonymous-only polls", async () => {
    const driver = makeSequenceDriver([ANONYMOUS_JAR, BASELINE_JAR]);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 60);

    expect(result.rotated).toBe(false);
    expect(store.saveFullJar).not.toHaveBeenCalled();
  });

  test("PSIDTS present without PSID does not count as signed out", async () => {
    const psidtsOnly = BASELINE_JAR.filter((c) => c.name !== "__Secure-1PSID");
    const driver = makeSequenceDriver([psidtsOnly]);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 60);

    expect(result.rotated).toBe(false);
  });

  test("PSID present without PSIDTS does not count as signed out", async () => {
    const psidOnly = BASELINE_JAR.filter((c) => c.name !== "__Secure-1PSIDTS");
    const driver = makeSequenceDriver([psidOnly]);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 60);

    expect(result.rotated).toBe(false);
  });

  test("transient poll errors do not build a signed-out streak", async () => {
    const driver = makeSequenceDriver([new Error("cli hiccup"), ANONYMOUS_JAR, new Error("cli hiccup"), ANONYMOUS_JAR, ANONYMOUS_JAR, ANONYMOUS_JAR, ANONYMOUS_JAR, ANONYMOUS_JAR]);
    const store = makeStore();
    const refresher = makeRefresher(driver, store);

    const err = await refresher.rotatePsidts("p", "baseline-ts", 500).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(BrowserSignedOutError);
  });
});
