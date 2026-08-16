import { describe, test, expect, mock } from "bun:test";
import type { Cookie } from "../../src/core/types.ts";
import { SessionKeepalive } from "../../src/auth/session-keepalive.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";

function cookie(name: string, value: string): Cookie {
  return {
    name,
    value,
    domain: ".google.com",
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function makeCookieStore(psidtsValue: string) {
  return {
    load: mock(async () => ({
      cookies: [
        cookie("__Secure-1PSID", "psid"),
        cookie("__Secure-1PSIDTS", psidtsValue),
      ],
      snapshot: new Map(),
    })),
  };
}

function makeRefresher() {
  return {
    rotatePsidts: mock(async () => ({ rotated: true, cookies: [] })),
  };
}

describe("SessionKeepalive", () => {
  test("first tick always rotates to establish baseline", async () => {
    const store = makeCookieStore("current-ts");
    const refresher = makeRefresher();
    const logger = makeLogger();

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => 0,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();

    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("no-op fast path: subsequent tick skips rotation when baseline unchanged and within interval", async () => {
    const store = makeCookieStore("current-ts");
    const refresher = makeRefresher();
    const logger = makeLogger();

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => 0,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("interval expiry: rotation runs after interval even if baseline unchanged", async () => {
    let storeValue = "ts";
    const store = {
      load: mock(async () => ({
        cookies: [
          cookie("__Secure-1PSID", "psid"),
          cookie("__Secure-1PSIDTS", storeValue),
        ],
        snapshot: new Map(),
      })),
    };
    const refresher = makeRefresher();
    const logger = makeLogger();
    let time = 0;

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);

    time += 600_000;
    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(2);
  });

  test("60s floor suppresses re-rotation when the baseline changed within the window", async () => {
    let storeValue = "ts1";
    const store = {
      load: mock(async () => ({
        cookies: [
          cookie("__Secure-1PSID", "psid"),
          cookie("__Secure-1PSIDTS", storeValue),
        ],
        snapshot: new Map(),
      })),
    };
    const refresher = makeRefresher();
    const logger = makeLogger();
    let time = 0;

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown({ now: () => time }),
      logger,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);

    time += 30_000;
    storeValue = "ts2";
    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("failed tick logs warning without surfacing error", async () => {
    const store = {
      load: mock(async () => {
        throw new Error("disk error");
      }),
    };
    const refresher = makeRefresher();
    const logger = makeLogger();

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => 0,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();

    expect(logger.warn).toHaveBeenCalled();
    const msg = logger.warn.mock.calls[0]![0] as string;
    expect(msg).toContain("disk error");
  });

  test("stop prevents any further ticks", async () => {
    const store = makeCookieStore("ts");
    const refresher = makeRefresher();
    const logger = makeLogger();

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => 0,
      setInterval: () => ({ unref: () => {} }),
    });

    keepalive.start();
    keepalive.stop();
    await keepalive.tick();

    expect(refresher.rotatePsidts).not.toHaveBeenCalled();
  });

  test("rotatePsidts is called with lastObservedBaseline on subsequent ticks when interval expires", async () => {
    let storeValue = "ts1";
    const store = {
      load: mock(async () => ({
        cookies: [
          cookie("__Secure-1PSID", "psid"),
          cookie("__Secure-1PSIDTS", storeValue),
        ],
        snapshot: new Map(),
      })),
    };
    const refresher = makeRefresher();
    const logger = makeLogger();
    let time = 0;

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledWith("p", null);

    time += 600_000;
    storeValue = "ts2";
    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledWith("p", "ts1");
  });

  test("rotatePsidts uses custom interval from options", async () => {
    const store = makeCookieStore("ts");
    const refresher = makeRefresher();
    const logger = makeLogger();

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown(),
      logger,
      now: () => 0,
      setInterval: () => ({ unref: () => {} }),
    }, { intervalMs: 30_000 });

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("custom cooldown floor is honored when the baseline changed within the window", async () => {
    let storeValue = "ts1";
    const store = {
      load: mock(async () => ({
        cookies: [
          cookie("__Secure-1PSID", "psid"),
          cookie("__Secure-1PSIDTS", storeValue),
        ],
        snapshot: new Map(),
      })),
    };
    const refresher = makeRefresher();
    const logger = makeLogger();
    let time = 0;

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher,
      cooldown: new RotationCooldown({ floorMs: 120_000, now: () => time }),
      logger,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);

    time += 90_000;
    storeValue = "ts2";
    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(1);

    time += 31_000;
    storeValue = "ts3";
    await keepalive.tick();
    expect(refresher.rotatePsidts).toHaveBeenCalledTimes(2);
  });
});
