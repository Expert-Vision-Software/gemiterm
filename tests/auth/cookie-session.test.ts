import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieSession, createCookieSession, toSdkCookieConfig } from "../../src/auth/cookie-session.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { SessionKeepalive } from "../../src/auth/session-keepalive.ts";
import { GEMINI_APP_URL } from "../../src/auth/auth-constants.ts";
import { SessionValidationError, LoginCancelledError, LoginTimeoutError } from "../../src/core/errors.ts";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";
import { PlaywrightCliError } from "../../src/services/playwright-cli-driver.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-facade");

let logs: string[] = [];
const origLog = console.log;

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  rmSync(join(TEST_DIR, "profiles"), { recursive: true, force: true });
  logs = [];
  console.log = ((...args: unknown[]) => { logs.push(args.map(String).join(" ")); }) as typeof console.log;
});

afterEach(() => {
  console.log = origLog;
  delete process.env.GEMITERM_CONFIG_DIR;
});

function cookie(name: string, value: string, domain = ".google.com", expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60): Cookie {
  return { name, value, domain, path: "/", expires, httpOnly: true, secure: true, sameSite: "Lax" };
}

const GATE_JAR = [cookie("__Secure-1PSID", "psid"), cookie("__Secure-1PSIDTS", "ts")];

const FULL_JAR = [
  ...GATE_JAR,
  cookie("SID", "sid"),
  cookie("HSID", "hsid"),
  cookie("NID", "nid"),
  cookie("YT", "yt", ".youtube.com"),
  cookie("THIRD", "x", ".example.com"),
];

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function makeStore(jar: Cookie[], mtime: Date | null = new Date()) {
  return {
    load: mock(async () => ({ cookies: jar, snapshot: new Map() })),
    getJarMtime: mock(async () => mtime),
    saveFullJar: mock(async () => {}),
  };
}

function makeDriver(cookiesByPoll: Cookie[] = FULL_JAR, stateJar: Cookie[] = FULL_JAR, cookieListImpl?: () => Promise<Cookie[]>) {
  const cookieList = cookieListImpl
    ? mock(cookieListImpl)
    : mock(async () => cookiesByPoll);
  return {
    openHeaded: mock(async () => {}),
    openHeadless: mock(async () => {}),
    cookieList,
    cookieListFromState: mock(async () => stateJar),
    closeSession: mock(async () => {}),
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const deps = {
    cookieStore: makeStore(GATE_JAR),
    validator: new CookieValidator({ logger: makeLogger() as never }),
    refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
    cooldown: new RotationCooldown(),
    classifier: {
      classify: mock(async () => "live" as const),
      classifyDetailed: mock(async () => ({ state: "live" as const, chatCount: 1 })),
    },
    recovery: { recover: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts", cookies: GATE_JAR })) },
    logger: makeLogger(),
    spawnRefreshRunner: mock(() => {}),
    listProfiles: mock(async () => ["p"]),
    conversationLookup: { profileHasConversation: mock(async () => false) },
    driver: makeDriver(),
    pollIntervalMs: 5,
  };
  return { ...deps, ...overrides };
}

function makeSession(deps: ReturnType<typeof makeDeps>): CookieSession {
  return new CookieSession(deps as never);
}

describe("CookieSession.ensureSession", () => {
  test("fresh jar arms from disk with zero network/browser work", async () => {
    const deps = makeDeps();
    const session = makeSession(deps);

    const armed = await session.ensureSession("p");

    expect(armed.secure_1psid).toBe("psid");
    expect(armed.secure_1psidts).toBe("ts");
    expect(deps.spawnRefreshRunner).not.toHaveBeenCalled();
    expect(deps.refresher.rotatePsidts).not.toHaveBeenCalled();
    expect(deps.classifier.classify).not.toHaveBeenCalled();
    expect(deps.driver.openHeaded).not.toHaveBeenCalled();
    expect(deps.driver.openHeadless).not.toHaveBeenCalled();
  });

  test("stale jar arms immediately and spawns the detached runner exactly once", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const deps = makeDeps({ cookieStore: makeStore(GATE_JAR, stale) });
    const session = makeSession(deps);

    const armed = await session.ensureSession("p");

    expect(armed.secure_1psid).toBe("psid");
    expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
    expect(deps.spawnRefreshRunner).toHaveBeenCalledWith("p");
  });

  test("repeated stale arms within one process spawn the runner only once per profile", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const deps = makeDeps({ cookieStore: makeStore(GATE_JAR, stale) });
    const session = makeSession(deps);

    await session.ensureSession("p");
    await session.ensureSession("p");
    await session.ensureSession("p");

    expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
  });

  test("legacy 2-cookie jar arms without error", async () => {
    const deps = makeDeps({ cookieStore: makeStore(GATE_JAR) });
    const session = makeSession(deps);
    await expect(session.ensureSession("p")).resolves.toHaveProperty("secure_1psid", "psid");
  });

  test("invalid jar rejects with the typed validation error", async () => {
    const deps = makeDeps({ cookieStore: makeStore([cookie("SID", "s")]) });
    const session = makeSession(deps);
    await expect(session.ensureSession("p")).rejects.toBeInstanceOf(SessionValidationError);
  });

  test("arms with the google.com-scoped SDK cookies when the jar also has youtube.com duplicates", async () => {
    const multiScope = [
      cookie("__Secure-1PSIDTS", "yt-ts", ".youtube.com"),
      cookie("__Secure-1PSID", "yt-psid", ".youtube.com"),
      cookie("__Secure-1PSID", "g-psid", ".google.com"),
      cookie("__Secure-1PSIDTS", "g-ts", ".google.com"),
    ];
    const deps = makeDeps({ cookieStore: makeStore(multiScope) });
    const session = makeSession(deps);

    const armed = await session.ensureSession("p");

    expect(armed.secure_1psid).toBe("g-psid");
    expect(armed.secure_1psidts).toBe("g-ts");
  });
});

describe("toSdkCookieConfig", () => {
  test("selects the cookie routable to gemini.google.com, not the youtube.com sibling", () => {
    const jar = [
      cookie("__Secure-1PSIDTS", "yt-ts", ".youtube.com"),
      cookie("__Secure-1PSID", "yt-psid", ".youtube.com"),
      cookie("__Secure-1PSID", "g-psid", ".google.com"),
      cookie("__Secure-1PSIDTS", "g-ts", ".google.com"),
    ];
    expect(toSdkCookieConfig(jar)).toEqual({ secure1psid: "g-psid", secure1psidts: "g-ts" });
  });

  test("falls back to any name match when nothing is routable", () => {
    const jar = [cookie("__Secure-1PSID", "x", ".example.com")];
    expect(toSdkCookieConfig(jar)).toEqual({ secure1psid: "x", secure1psidts: null });
  });
});

describe("CookieSession.captureLogin", () => {
  test("gate is not payload: persists the full domain-filtered jar", async () => {
    const deps = makeDeps();
    const session = makeSession(deps);

    const result = await session.captureLogin("p");

    expect(deps.driver.openHeaded).toHaveBeenCalledWith(GEMINI_APP_URL, "p", "p");
    expect(deps.cookieStore.saveFullJar).toHaveBeenCalledTimes(1);
    const [profile, saved] = deps.cookieStore.saveFullJar.mock.calls[0] as [string, Cookie[]];
    expect(profile).toBe("p");
    const names = saved.map((c) => c.name);
    expect(names).toContain("SID");
    expect(names).toContain("HSID");
    expect(names).toContain("NID");
    expect(names).toContain("YT");
    expect(names).not.toContain("THIRD");
    expect(result.cookies.length).toBe(saved.length);
    expect(logs.join("\n")).toContain("Authentication successful");
    expect(logs.join("\n")).toContain(`${saved.length} cookies`);
    expect(logs.join("\n")).toContain("Session expires");
    expect(deps.driver.closeSession).toHaveBeenCalledWith("p");
  });

  test("notification prints without blocking", async () => {
    const deps = makeDeps();
    const session = makeSession(deps);
    await session.captureLogin("p");
    const out = logs.join("\n");
    expect(out).toContain("Opening headed browser");
    expect(out).toContain(GEMINI_APP_URL);
    expect(out).toContain("auto-detect");
    expect(deps.driver.openHeaded).toHaveBeenCalledTimes(1);
  });

  test("timeout closes the browser and rejects with the typed timeout error", async () => {
    const deps = makeDeps({ driver: makeDriver([cookie("SID", "s")], FULL_JAR) });
    const session = makeSession(deps);

    await expect(session.captureLogin("p", { timeoutMs: 30 })).rejects.toBeInstanceOf(LoginTimeoutError);

    expect(deps.driver.closeSession).toHaveBeenCalledWith("p");
    expect(deps.cookieStore.saveFullJar).not.toHaveBeenCalled();
  });

  test("renew mode prints renewal text", async () => {
    const deps = makeDeps();
    const session = makeSession(deps);
    await session.captureLogin("p", { mode: "renew" });
    const out = logs.join("\n");
    expect(out).toContain("Renewal successful");
    expect(out).not.toContain("Authentication successful");
  });

  test("browser closed mid-poll rejects with LoginCancelledError, closes once, persists nothing, and logs once", async () => {
    const closedErr = new PlaywrightCliError("cookie-list", 1, "Browser p is not open");
    const cookieListImpl = mock(async () => {
      throw closedErr;
    });
    const logger = makeLogger();
    const driver = makeDriver(FULL_JAR, FULL_JAR, cookieListImpl);
    const deps = makeDeps({ driver, logger, pollIntervalMs: 1 });
    const session = makeSession(deps);

    await expect(session.captureLogin("p", { timeoutMs: 5_000 })).rejects.toBeInstanceOf(LoginCancelledError);

    expect(driver.closeSession).toHaveBeenCalledTimes(1);
    expect(driver.closeSession).toHaveBeenCalledWith("p");
    expect(driver.cookieListFromState).not.toHaveBeenCalled();
    expect(deps.cookieStore.saveFullJar).not.toHaveBeenCalled();

    const infoMessages = logger.info.mock.calls.map((c) => String(c[0])).join("\n");
    expect(infoMessages).toContain("Gate poll cancelled");

    const debugMessages = logger.debug.mock.calls.map((c) => String(c[0])).join("\n");
    expect(debugMessages).not.toContain("Gate poll failed");
  });

  test("transient cookieList errors still poll until timeout", async () => {
    const transientErr = new PlaywrightCliError("cookie-list", 1, "network blip");
    const driver = makeDriver([cookie("SID", "s")], FULL_JAR, mock(async () => {
      throw transientErr;
    }));
    const logger = makeLogger();
    const deps = makeDeps({ driver, logger, pollIntervalMs: 1 });
    const session = makeSession(deps);

    await expect(session.captureLogin("p", { timeoutMs: 30 })).rejects.toBeInstanceOf(LoginTimeoutError);

    const debugMessages = logger.debug.mock.calls.map((c) => String(c[0])).join("\n");
    expect(debugMessages).toContain("Gate poll failed");
    expect(driver.closeSession).toHaveBeenCalledWith("p");
  });
});

describe("CookieSession delegation", () => {
  test("probe delegates to the classifier", async () => {
    const deps = makeDeps({ classifier: { classify: mock(async () => "phantom" as const) } });
    const session = makeSession(deps);
    expect(await session.probe("p")).toBe("phantom");
    expect(deps.classifier.classify).toHaveBeenCalledWith("p");
  });

  test("probeDetailed delegates to the classifier", async () => {
    const deps = makeDeps({
      classifier: {
        classify: mock(async () => "phantom" as const),
        classifyDetailed: mock(async () => ({ state: "phantom" as const, chatCount: 0 })),
      },
    });
    const session = makeSession(deps);
    expect(await session.probeDetailed("p")).toEqual({ state: "phantom", chatCount: 0 });
    expect(deps.classifier.classifyDetailed).toHaveBeenCalledWith("p");
  });

  test("refresh uses the on-disk PSIDTS as baseline", async () => {
    const rotatePsidts = mock(async (_p: string, baseline: string | null) => {
      expect(baseline).toBe("ts");
      return { rotated: true };
    });
    const deps = makeDeps({ refresher: { rotatePsidts } });
    const session = makeSession(deps);
    const result = await session.refresh("p");
    expect(result.rotated).toBe(true);
  });

  test("activeProfiles keeps only live profiles", async () => {
    const classify = mock(async (name: string) => (name === "a" ? "live" : name === "b" ? "phantom" : "dead") as "live" | "phantom" | "dead");
    const deps = makeDeps({
      listProfiles: mock(async () => ["a", "b", "c"]),
      classifier: { classify },
    });
    const session = makeSession(deps);
    expect(await session.activeProfiles()).toEqual(["a"]);
  });

  test("findProfileForConversation resolves the owning profile or null", async () => {
    const profileHasConversation = mock(async (profile: string, _cid: string) => profile === "a");
    const deps = makeDeps({
      listProfiles: mock(async () => ["a", "b"]),
      conversationLookup: { profileHasConversation },
    });
    const session = makeSession(deps);
    expect(await session.findProfileForConversation("cid-1")).toBe("a");
    expect(profileHasConversation).toHaveBeenCalledWith("a", "cid-1");

    const none = makeDeps({
      listProfiles: mock(async () => ["a"]),
      conversationLookup: { profileHasConversation: mock(async () => false) },
    });
    expect(await makeSession(none).findProfileForConversation("cid-2")).toBeNull();
  });

  test("recovery rung is exposed for fix-2 wiring", async () => {
    const deps = makeDeps();
    const session = makeSession(deps);
    expect(typeof session.recover).toBe("function");
  });
});

describe("createCookieSession factory", () => {
  test("wires real collaborators; probe path loads jar and delegates to the probe client", async () => {
    const jar = [cookie("__Secure-1PSID", "psid"), cookie("__Secure-1PSIDTS", "ts")];
    const dir = join(TEST_DIR, "profiles", "facade-p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "storage_state.json"), JSON.stringify({ cookies: jar }), "utf-8");

    const listChats = mock(async (options?: { limit?: number }) =>
      options?.limit === 1 ? [{ id: "c1" }] : [{ id: "c1" }, { id: "c2" }],
    );
    const logger = makeLogger();
    const session = createCookieSession({
      logger: logger as never,
      cookieStore: new CookieStore(),
      listProfiles: async () => ["facade-p"],
      spawnRefreshRunner: () => {},
      createProbeClient: (config) => {
        expect(config.secure1psid).toBe("psid");
        expect(config.secure1psidts).toBe("ts");
        return { listChats };
      },
    });

    expect(await session.probe("facade-p")).toBe("live");
    expect(await session.probeDetailed("facade-p")).toEqual({ state: "live", chatCount: 2 });
    expect(await session.activeProfiles()).toEqual(["facade-p"]);
    expect(await session.findProfileForConversation("c1")).toBe("facade-p");
    expect(await session.findProfileForConversation("missing")).toBeNull();
    expect(listChats).toHaveBeenCalled();
  });
});

describe("CookieSession.createKeepalive (fix-3b)", () => {
  test("factory wires the facade's collaborators and the shared cooldown (both directions)", async () => {
    const rotatePsidts = mock(async () => ({ rotated: true }));
    const deps = makeDeps({ refresher: { rotatePsidts } });
    const session = makeSession(deps);

    const keepalive = session.createKeepalive("p");
    expect(typeof keepalive.start).toBe("function");
    expect(typeof keepalive.stop).toBe("function");

    await keepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);

    const suppressed = await session.refresh("p");
    expect(suppressed.rotated).toBe(false);
    expect(rotatePsidts).toHaveBeenCalledTimes(1);

    const freshKeepalive = session.createKeepalive("p");
    await freshKeepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);
  });
});

describe("shared rotation floor (fix-3b)", () => {
  test("manual refresh 30s after a keepalive rotation resolves { rotated: false } without touching the refresher", async () => {
    let time = 0;
    const rotatePsidts = mock(async () => ({ rotated: true }));
    const logger = makeLogger();
    const deps = makeDeps({
      refresher: { rotatePsidts },
      cooldown: new RotationCooldown({ now: () => time }),
      logger,
    });
    const session = makeSession(deps);

    const keepalive = new SessionKeepalive("p", {
      cookieStore: deps.cookieStore,
      refresher: deps.refresher,
      cooldown: deps.cooldown,
      logger,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });
    await keepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);

    time += 30_000;
    const result = await session.refresh("p");

    expect(result).toEqual({ rotated: false });
    expect(rotatePsidts).toHaveBeenCalledTimes(1);
    const debugMessages = logger.debug.mock.calls.map((c) => String(c[0])).join("\n");
    expect(debugMessages).toContain("suppressed");
  });

  test("keepalive tick 30s after a manual rotation skips the browser and reschedules", async () => {
    let time = 0;
    const rotatePsidts = mock(async () => ({ rotated: true }));
    const logger = makeLogger();
    const deps = makeDeps({
      refresher: { rotatePsidts },
      cooldown: new RotationCooldown({ now: () => time }),
      logger,
    });
    const session = makeSession(deps);

    const result = await session.refresh("p");
    expect(result.rotated).toBe(true);
    expect(rotatePsidts).toHaveBeenCalledTimes(1);

    const keepalive = new SessionKeepalive("p", {
      cookieStore: deps.cookieStore,
      refresher: deps.refresher,
      cooldown: deps.cooldown,
      logger,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });
    time += 30_000;
    await keepalive.tick();

    expect(rotatePsidts).toHaveBeenCalledTimes(1);
    const debugMessages = logger.debug.mock.calls.map((c) => String(c[0])).join("\n");
    expect(debugMessages).toContain("suppressed");
  });

  test("manual refresh after the floor window expires rotates normally", async () => {
    let time = 0;
    const rotatePsidts = mock(async () => ({ rotated: true }));
    const deps = makeDeps({
      refresher: { rotatePsidts },
      cooldown: new RotationCooldown({ now: () => time }),
    });
    const session = makeSession(deps);

    await session.refresh("p");
    time += 60_000;
    const result = await session.refresh("p");

    expect(result.rotated).toBe(true);
    expect(rotatePsidts).toHaveBeenCalledTimes(2);
  });
});
