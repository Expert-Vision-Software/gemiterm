// Invariant: single-flight detached rotation + de-raced recovery (fix-
// rotation-dead-end). Drives the real lock file, the real spawn gate, and the
// real CookieSession recovery seam against on-disk truth. The detached runner
// is simulated by a side-write of a rotated jar, per the suite convention.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { existsSync, utimesSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { makeRunnerLock } from "../../src/auth/refresh-runner-lock.ts";
import { spawnDetachedRefreshRunner } from "../../src/auth/refresh-runner.ts";
import { RecoveryRung } from "../../src/auth/recovery.ts";
import { freshFullJar } from "./fixtures.ts";
import { TEST_DIR, setupIsolation, teardownIsolation, makeSessionDeps, makeSession, psidtsValue, withPsidts, makeLogger } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const lockPath = (profile: string) => join(TEST_DIR, "profiles", profile, "refresh-runner.lock");

const STALE_MTIME = () => new Date(Date.now() - 45 * 60 * 1000);

describe("auth-regression: rotation single-flight lock", () => {
  test("acquire is exclusive until release, then acquirable again", async () => {
    const lock = makeRunnerLock();

    expect(await lock.tryAcquire("p")).toBe(true);
    expect(await lock.tryAcquire("p")).toBe(false);
    await lock.release("p");
    expect(await lock.tryAcquire("p")).toBe(true);
  });

  test("a lock older than the stale window is swept and reacquired", async () => {
    const lock = makeRunnerLock();
    expect(await lock.tryAcquire("p")).toBe(true);

    // simulate a crashed runner: the held lock's mtime is 5 minutes old
    const stale = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(lockPath("p"), stale, stale);

    expect(await lock.tryAcquire("p")).toBe(true);
  });
});

describe("auth-regression: spawn gate", () => {
  test("second process's spawn is skipped while the first holds the lock", async () => {
    let spawnCalls = 0;
    const spawn = () => {
      spawnCalls++;
      return { exited: Promise.resolve(0) };
    };

    await spawnDetachedRefreshRunner("gate", { openLogFd: () => 1, spawn });
    expect(spawnCalls).toBe(1);
    expect(existsSync(lockPath("gate"))).toBe(true);

    await spawnDetachedRefreshRunner("gate", { openLogFd: () => 1, spawn });
    expect(spawnCalls).toBe(1);
  });
});

describe("auth-regression: recovery de-race", () => {
  test("recover awaits the in-flight rotation and re-arms without the recovery rung", async () => {
    const store = new CookieStore();
    await store.saveFullJar("p", freshFullJar());
    const recovery = { recover: mock(async () => { throw new Error("recovery rung must not run"); }) };
    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Cookie[]) => store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      recovery,
      rotationWaitMs: 5_000,
    });
    const session = makeSession(deps);
    await session.ensureSession("p");
    expect(session.rotationInFlight("p")).toBe(true);

    const rotated = `recovered-${Date.now()}`;
    const timer = setTimeout(async () => {
      await store.saveFullJar("p", withPsidts(freshFullJar(), rotated));
    }, 20);

    const armed = await session.recover("p");
    clearTimeout(timer);

    expect(psidtsValue(armed.cookies)).toBe(rotated);
    expect(recovery.recover).not.toHaveBeenCalled();
    expect(session.rotationInFlight("p")).toBe(false);
  });

  test("recover falls through to the rung when no rotation lands", async () => {
    const store = new CookieStore();
    await store.saveFullJar("p", freshFullJar());
    const recovery = { recover: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "rung-ts", cookies: freshFullJar() })) };
    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Cookie[]) => store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      recovery,
      rotationWaitMs: 20,
    });
    const session = makeSession(deps);
    await session.ensureSession("p");

    const armed = await session.recover("p");

    expect(recovery.recover).toHaveBeenCalledTimes(1);
    expect(armed.secure_1psidts).toBe("rung-ts");
  });

  test("recover passthrough when no rotation was ever armed", async () => {
    const recovery = { recover: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "rung-ts", cookies: freshFullJar() })) };
    const session = makeSession(makeSessionDeps({ recovery }));

    const armed = await session.recover("p");

    expect(recovery.recover).toHaveBeenCalledWith("p");
    expect(armed.secure_1psidts).toBe("rung-ts");
  });
});

describe("auth-regression: recovery session name + wait ceiling", () => {
  test("RecoveryRung rotates under recover-<profile>, never the runner's session", async () => {
    // One jar, generated once: the load fake serves it and the assertion reads
    // it, so the Date.now()-derived psidts suffix cannot tick between
    // recover()-time and assert-time (CI flake, run 32223428823).
    const jar = freshFullJar();
    const rotatePsidts = mock(async () => ({ rotated: true }));
    const rung = new RecoveryRung({
      refresher: { rotatePsidts },
      cookieStore: { load: mock(async () => ({ cookies: jar })) },
      rearm: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts", cookies: freshFullJar() })),
      logger: makeLogger() as never,
    });

    await rung.recover("p");

    expect(rotatePsidts).toHaveBeenCalledWith("p", psidtsValue(jar) ?? null, undefined, "recover-p");
    expect(JSON.stringify(rotatePsidts.mock.calls[0])).not.toContain("refresh-p");
  });

  test("the default rotation wait covers the 60s rotate budget", async () => {
    const session = makeSession(makeSessionDeps());
    const waitMs = (session as unknown as { rotationWaitMs: number }).rotationWaitMs;
    expect(waitMs).toBeGreaterThanOrEqual(75_000);
  });

  test("rotation failure names the signed-out-server-side condition", async () => {
    const rung = new RecoveryRung({
      refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
      cookieStore: { load: mock(async () => ({ cookies: freshFullJar() })) },
      rearm: mock(async () => { throw new Error("unreachable"); }),
      logger: makeLogger() as never,
    });

    await expect(rung.recover("p")).rejects.toThrow(/signed out server-side/);
  });
});
