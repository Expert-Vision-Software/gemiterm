// Invariant: read commands await an in-flight detached rotation before
// surfacing an auth failure (extend-rotation-wait-to-read-commands). Drives
// the real CookieSession + CookieStore against on-disk jars and runs the
// command layer's retry helper (`runWithRotationRetry`) over that surface.
// Asserts on-disk truth and passivity (the wait never spawns a second runner).
import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { runWithRotationRetry } from "../../src/cli/utils/rotation-await.ts";
import { freshFullJar } from "./fixtures.ts";
import {
  TEST_DIR,
  setupIsolation,
  teardownIsolation,
  makeSessionDeps,
  makeSession,
  psidtsValue,
  withPsidts,
} from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const jarPath = (profile: string) => join(TEST_DIR, "profiles", profile, "storage_state.json");

function psidtsOnDisk(profile: string): string | undefined {
  return psidtsValue(JSON.parse(readFileSync(jarPath(profile), "utf-8")).cookies as Cookie[]);
}

const STALE_MTIME = () => new Date(Date.now() - 45 * 60 * 1000);

describe("auth-regression: read commands await in-flight rotation", () => {
  test("the retry helper recovers when the detached rotation lands, spawning nothing extra", async () => {
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

    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await runWithRotationRetry(
        session,
        "p",
        async () => psidtsOnDisk("p"),
        (psidts) => psidts !== rotated,
      );
      clearTimeout(timer);

      expect(result).toBe(rotated);
      expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
      expect(session.rotationInFlight("p")).toBe(false);
    } finally {
      clearTimeout(timer);
      errSpy.mockRestore();
    }
  });

  test("the retry helper times out, falls through, and spawns nothing", async () => {
    const store = new CookieStore();
    const baseline = freshFullJar();
    await store.saveFullJar("p", baseline);
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

    const baselinePsidts = psidtsValue(baseline);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await runWithRotationRetry(
        session,
        "p",
        async () => psidtsOnDisk("p"),
        (psidts) => psidts === baselinePsidts,
      );

      expect(result).toBe(baselinePsidts);
      expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
      expect(session.rotationInFlight("p")).toBe(true);
      expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("still in progress");
    } finally {
      errSpy.mockRestore();
    }
  });
});
