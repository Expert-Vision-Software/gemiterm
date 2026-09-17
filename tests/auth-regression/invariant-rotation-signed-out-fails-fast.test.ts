// Invariant: PSIDTS rotation fails fast when the rotation browser session is
// signed out (issue: signed-out rotation burns the full 60s timeout and
// misleads the user). A signed-out browser's cookie DB holds only anonymous
// cookies - no routable __Secure-1PSID and no routable __Secure-1PSIDTS - so
// rotation can never succeed and the loop must abort with a typed
// BrowserSignedOutError naming `gemiterm auth <profile>` instead of timing
// out. Routability is judged by findRoutableCookieValue, never by name-only
// presence; the anonymous-only shape must hold on 2 consecutive polls before
// the throw (startup-race guard); driver failures never count toward the
// streak. Asserted at the unit seam with a fake driver - no real browser.
import { describe, test, expect, mock } from "bun:test";
import type { Cookie } from "../../src/core/types.ts";
import { BrowserRefresher } from "../../src/auth/browser-refresher.ts";
import { BrowserSignedOutError } from "../../src/core/errors.ts";
import { deadJar } from "./fixtures.ts";

const SIGNED_IN_JAR: Cookie[] = [
  { name: "__Secure-1PSID", value: "psid", domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: true, secure: true, sameSite: "Lax" },
  { name: "__Secure-1PSIDTS", value: "baseline-ts", domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: true, secure: true, sameSite: "Lax" },
];

function makeDriver(pollResponses: (Cookie[] | Error)[]) {
  let call = 0;
  return {
    openHeadless: mock(async () => {}),
    cookieList: mock(async () => {
      const response = pollResponses[Math.min(call, pollResponses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return response;
    }),
    cookieListFromState: mock(async () => SIGNED_IN_JAR),
    closeSession: mock(async () => {}),
  };
}

function makeRefresher(driver: ReturnType<typeof makeDriver>) {
  return new BrowserRefresher({
    driver,
    cookieStore: { saveFullJar: mock(async () => {}), load: mock(async () => ({ cookies: SIGNED_IN_JAR, snapshot: new Map() })) } as never,
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
    pollIntervalMs: 10,
  });
}

describe("auth-regression: rotation fails fast on signed-out browser", () => {
  test("two consecutive anonymous-only polls abort with BrowserSignedOutError well before the timeout", async () => {
    const driver = makeDriver([deadJar()]);
    const refresher = makeRefresher(driver);

    const started = Date.now();
    const err = await refresher.rotatePsidts("p", "baseline-ts", 60_000).catch((e: unknown) => e as Error);
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(BrowserSignedOutError);
    expect(err.name).toBe("BrowserSignedOutError");
    expect(err.message).toContain("signed out");
    expect(err.message).toContain("gemiterm auth p");
    expect(driver.cookieList.mock.calls.length).toBeLessThanOrEqual(3);
    expect(elapsed).toBeLessThan(5_000);
    expect(driver.closeSession).toHaveBeenCalledTimes(1);
    expect(driver.cookieListFromState).not.toHaveBeenCalled();
  });

  test("signed-in cookies on the second poll cancel the streak - no abort", async () => {
    const driver = makeDriver([deadJar(), SIGNED_IN_JAR]);
    const refresher = makeRefresher(driver);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 60);

    expect(result.rotated).toBe(false);
  });

  test("one routable auth cookie (either name) is enough to keep waiting", async () => {
    const psidOnly: Cookie[] = SIGNED_IN_JAR.filter((c) => c.name === "__Secure-1PSID");
    const driver = makeDriver([psidOnly]);
    const refresher = makeRefresher(driver);

    const result = await refresher.rotatePsidts("p", "baseline-ts", 60);

    expect(result.rotated).toBe(false);
  });

  test("driver failures never build the signed-out streak", async () => {
    const driver = makeDriver([new Error("hiccup"), deadJar(), new Error("hiccup"), deadJar(), deadJar(), deadJar(), deadJar(), deadJar()]);
    const refresher = makeRefresher(driver);

    const err = await refresher.rotatePsidts("p", "baseline-ts", 500).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(BrowserSignedOutError);
  });
});
