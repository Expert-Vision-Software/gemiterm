// Invariant: awaiting the detached rotation (await-detached-rotation-on-empty-
// list). Drives the real CookieSession + CookieStore against on-disk jars; the
// detached runner is simulated by a side-write of a rotated jar. Asserts
// on-disk truth and passivity (no spawn / no write during the wait).
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { freshFullJar } from "./fixtures.ts";
import { TEST_DIR, setupIsolation, teardownIsolation, makeSessionDeps, makeSession, psidtsValue, withPsidts } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const jarPath = (profile: string) => join(TEST_DIR, "profiles", profile, "storage_state.json");

function psidtsOnDisk(profile: string): string | undefined {
  return psidtsValue(JSON.parse(readFileSync(jarPath(profile), "utf-8")).cookies as Cookie[]);
}

const STALE_MTIME = () => new Date(Date.now() - 45 * 60 * 1000);
const FRESH_MTIME = () => new Date();

describe("auth-regression: await detached rotation", () => {
  test("fresh arm short-circuits the wait and never spawns", async () => {
    const store = new CookieStore();
    await store.saveFullJar("p", freshFullJar());
    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Cookie[]) => store.saveFullJar(p, c),
        getJarMtime: async () => FRESH_MTIME(),
      },
    });
    const session = makeSession(deps);

    await session.ensureSession("p");

    expect(session.rotationInFlight("p")).toBe(false);
    expect(await session.waitForRotation("p")).toBeNull();
    expect(deps.spawnRefreshRunner).not.toHaveBeenCalled();
  });

  test("stale arm records the baseline, spawns once, and the landed rotation re-arms", async () => {
    const store = new CookieStore();
    await store.saveFullJar("p", freshFullJar());
    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Cookie[]) => store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      rotationWaitMs: 5_000,
    });
    const session = makeSession(deps);

    await session.ensureSession("p");
    expect(session.rotationInFlight("p")).toBe(true);
    expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);

    const rotated = `rotated-${Date.now()}`;
    const timer = setTimeout(async () => {
      await store.saveFullJar("p", withPsidts(freshFullJar(), rotated));
    }, 20);

    const refreshed = await session.waitForRotation("p");
    clearTimeout(timer);

    expect(refreshed).not.toBeNull();
    expect(psidtsValue(refreshed!.cookies)).toBe(rotated);
    expect(psidtsOnDisk("p")).toBe(rotated);
    expect(session.rotationInFlight("p")).toBe(false);
    expect(await session.waitForRotation("p")).toBeNull();
    expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
  });

  test("timeout resolves null, keeps the rotation in flight, and writes nothing", async () => {
    const store = new CookieStore();
    const baselineJar = freshFullJar();
    await store.saveFullJar("p", baselineJar);
    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Cookie[]) => store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      rotationWaitMs: 30,
    });
    const session = makeSession(deps);
    await session.ensureSession("p");

    const result = await session.waitForRotation("p");

    expect(result).toBeNull();
    expect(session.rotationInFlight("p")).toBe(true);
    expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
    expect(psidtsOnDisk("p")).toBe(psidtsValue(baselineJar));
  });

  test("never-armed profile reports no rotation and short-circuits", async () => {
    const deps = makeSessionDeps();
    const session = makeSession(deps);

    expect(session.rotationInFlight("p")).toBe(false);
    expect(await session.waitForRotation("p")).toBeNull();
    expect(deps.spawnRefreshRunner).not.toHaveBeenCalled();
  });
});
