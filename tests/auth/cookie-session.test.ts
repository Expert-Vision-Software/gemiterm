import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieSession } from "../../src/auth/cookie-session.ts";
import { GEMINI_APP_URL } from "../../src/auth/auth-constants.ts";
import { SessionValidationError, LoginTimeoutError } from "../../src/core/errors.ts";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";

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

function makeDriver(cookiesByPoll: Cookie[] = FULL_JAR, stateJar: Cookie[] = FULL_JAR) {
  return {
    openHeaded: mock(async () => {}),
    openHeadless: mock(async () => {}),
    cookieList: mock(async () => cookiesByPoll),
    cookieListFromState: mock(async () => stateJar),
    closeSession: mock(async () => {}),
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const deps = {
    cookieStore: makeStore(GATE_JAR),
    validator: new CookieValidator({ logger: makeLogger() as never }),
    refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
    classifier: { classify: mock(async () => "live" as const) },
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
});

describe("CookieSession delegation", () => {
  test("probe delegates to the classifier", async () => {
    const deps = makeDeps({ classifier: { classify: mock(async () => "phantom" as const) } });
    const session = makeSession(deps);
    expect(await session.probe("p")).toBe("phantom");
    expect(deps.classifier.classify).toHaveBeenCalledWith("p");
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
