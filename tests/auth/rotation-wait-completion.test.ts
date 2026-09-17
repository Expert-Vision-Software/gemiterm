import { describe, test, expect, mock } from "bun:test";
import type { Cookie } from "../../src/core/types.ts";
import { CookieSession } from "../../src/auth/cookie-session.ts";
import { makeRunnerLockObserver, type RunnerLockIo, type RunnerLockObserver } from "../../src/auth/refresh-runner-lock.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";

function cookie(name: string, value: string): Cookie {
  return { name, value, domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: true, secure: true, sameSite: "Lax" };
}

const JAR = [cookie("__Secure-1PSID", "psid"), cookie("__Secure-1PSIDTS", "ts")];

function withTs(jar: Cookie[], value: string): Cookie[] {
  return jar.map((c) => (c.name === "__Secure-1PSIDTS" ? { ...c, value } : c));
}

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    load: mock(async () => ({ cookies: JAR, snapshot: new Map() })),
    getJarMtime: mock(async () => new Date(Date.now() - 60 * 60 * 1000)),
    saveFullJar: mock(async () => {}),
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const deps = {
    cookieStore: makeStore(),
    validator: new CookieValidator({ logger: makeLogger() as never }),
    refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
    cooldown: new RotationCooldown(),
    classifier: {
      classify: mock(async () => "live" as const),
      classifyDetailed: mock(async () => ({ state: "live" as const, chatCount: 1 })),
    },
    recovery: { recover: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts", cookies: JAR })) },
    logger: makeLogger(),
    spawnRefreshRunner: mock(() => {}),
    listProfiles: mock(async () => ["p"]),
    conversationLookup: { profileHasConversation: mock(async () => false) },
    driver: {
      openHeaded: mock(async () => {}),
      openHeadless: mock(async () => {}),
      cookieList: mock(async () => JAR),
      cookieListFromState: mock(async () => JAR),
      closeSession: mock(async () => {}),
    },
    pollIntervalMs: 5,
  };
  return { ...deps, ...overrides };
}

function infoText(deps: ReturnType<typeof makeDeps>): string {
  return (deps.logger.info.mock.calls as unknown[][]).map((c) => String(c[0])).join("\n");
}

describe("waitForRotation observes runner-lock completion", () => {
  test("lock released mid-wait ends the wait before the timeout and concludes the rotation", async () => {
    let lockChecks = 0;
    const runnerLock: RunnerLockObserver = { isActive: mock(async () => ++lockChecks <= 2) };
    const cookieStore = makeStore();
    const deps = makeDeps({ cookieStore, runnerLock, rotationWaitMs: 3_000 });
    const session = new CookieSession(deps as never);
    await session.ensureSession("p");
    expect(session.rotationInFlight("p")).toBe(true);

    const started = Date.now();
    const result = await session.waitForRotation("p");
    const elapsed = Date.now() - started;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(1_500);
    expect(infoText(deps)).toContain("concluded without a jar change");
    expect(session.rotationInFlight("p")).toBe(false);

    const loadsBefore = (cookieStore.load.mock.calls as unknown[][]).length;
    expect(await session.waitForRotation("p")).toBeNull();
    expect((cookieStore.load.mock.calls as unknown[][]).length).toBe(loadsBefore);
  });

  test("lock present and fresh keeps the wait running to the timeout, rotation stays in flight", async () => {
    const runnerLock: RunnerLockObserver = { isActive: mock(async () => true) };
    const deps = makeDeps({ runnerLock, rotationWaitMs: 60 });
    const session = new CookieSession(deps as never);
    await session.ensureSession("p");

    const started = Date.now();
    const result = await session.waitForRotation("p");
    const elapsed = Date.now() - started;

    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(infoText(deps)).toContain("still in flight");
    expect(session.rotationInFlight("p")).toBe(true);
  });

  test("stale lock from the start concludes after the startup grace without a jar change", async () => {
    const runnerLock: RunnerLockObserver = { isActive: mock(async () => false) };
    const deps = makeDeps({ runnerLock, rotationWaitMs: 3_000 });
    const session = new CookieSession(deps as never);
    await session.ensureSession("p");

    const started = Date.now();
    const result = await session.waitForRotation("p");
    const elapsed = Date.now() - started;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(1_500);
    expect(infoText(deps)).toContain("concluded without a jar change");
    expect(session.rotationInFlight("p")).toBe(false);
  });

  test("startup grace: lock absent for the first two polls but appearing later keeps the wait alive until the jar lands", async () => {
    let lockChecks = 0;
    const runnerLock: RunnerLockObserver = { isActive: mock(async () => ++lockChecks > 2) };
    let jar = JAR;
    let loads = 0;
    const cookieStore = makeStore({
      load: mock(async () => {
        if (++loads === 6) jar = withTs(JAR, "rotated");
        return { cookies: jar, snapshot: new Map() };
      }),
    });
    const deps = makeDeps({ cookieStore, runnerLock, rotationWaitMs: 3_000 });
    const session = new CookieSession(deps as never);
    await session.ensureSession("p");

    const result = await session.waitForRotation("p");

    expect(result).not.toBeNull();
    expect(result!.secure_1psidts).toBe("rotated");
    expect(infoText(deps)).toContain("Rotation observed");
    expect(session.rotationInFlight("p")).toBe(false);
  });

  test("no runner lock seam (direct construction) keeps the conservative full-timeout wait", async () => {
    const deps = makeDeps({ rotationWaitMs: 60 });
    const session = new CookieSession(deps as never);
    await session.ensureSession("p");

    const started = Date.now();
    const result = await session.waitForRotation("p");
    const elapsed = Date.now() - started;

    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(session.rotationInFlight("p")).toBe(true);
  });
});

describe("makeRunnerLockObserver", () => {
  function fakeIo(overrides: Partial<RunnerLockIo>): RunnerLockIo {
    return {
      existsFile: mock(async () => true),
      getFileMtime: mock(async () => new Date()),
      removeFile: mock(async () => {}),
      writeFileExclusive: mock(async () => true),
      ...overrides,
    };
  }

  test("missing lock file reports inactive (rotation concluded)", async () => {
    const observer = makeRunnerLockObserver(fakeIo({ existsFile: mock(async () => false) }));
    expect(await observer.isActive("p")).toBe(false);
  });

  test("fresh lock file reports active", async () => {
    const observer = makeRunnerLockObserver(fakeIo({}));
    expect(await observer.isActive("p")).toBe(true);
  });

  test("lock older than the stale window reports inactive", async () => {
    const observer = makeRunnerLockObserver(
      fakeIo({ getFileMtime: mock(async () => new Date(Date.now() - 121_000)) }),
    );
    expect(await observer.isActive("p")).toBe(false);
  });

  test("observation failure reports active (keep waiting) and never rejects", async () => {
    const observer = makeRunnerLockObserver(
      fakeIo({
        existsFile: mock(async () => {
          throw new Error("io exploded");
        }),
      }),
    );
    expect(await observer.isActive("p")).toBe(true);
  });
});
