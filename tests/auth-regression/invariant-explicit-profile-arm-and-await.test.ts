// Invariant: explicit `-p <stale>` arms the profile, awaits an in-flight
// detached rotation when one is observed, and proceeds when the profile
// classifies live. Field repro (DHBGAMING2, 2026-08-18): `fetch -p <stale>`
// rejected instantly before the detached runner — spawned by the very arm
// that was needed — could land. Drives the real CookieSession + real
// CookieStore (on-disk truth); the rotation is simulated by a side-write of
// a rotated jar.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { resolveProfile } from "../../src/cli/utils/profile-resolution.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
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
import type { CliCommandContext } from "../../src/cli/command-registry.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const STALE_MTIME = () => new Date(Date.now() - 45 * 60 * 1000);
const FRESH_MTIME = () => new Date();

async function makeArmedSession(store: CookieStore, opts: { stale: boolean; rotationWaitMs?: number; profileName?: string }) {
  const profileName = opts.profileName ?? "stale";
  const deps = makeSessionDeps({
    cookieStore: {
      load: (p: string) => store.load(p),
      saveFullJar: (p: string, c: Parameters<CookieStore["saveFullJar"]>[1]) =>
        store.saveFullJar(p, c),
      getJarMtime: async () => (opts.stale ? STALE_MTIME() : FRESH_MTIME()),
    },
    listProfiles: mock(async () => [profileName]),
    rotationWaitMs: opts.rotationWaitMs ?? 5_000,
  });
  const session = makeSession(deps);
  return { session, deps, profileName };
}

describe("auth-regression: explicit -p arm-and-await", () => {
  test("explicit profile arms, awaits the in-flight rotation, reclassifies live, and proceeds", async () => {
    const store = new CookieStore();
    await store.saveFullJar("stale", freshFullJar());
    const { session, deps } = await makeArmedSession(store, { stale: true, profileName: "stale" });

    deps.classifier.classify = mock(async () => "live" as const);

    const rotated = `rotated-${Date.now()}`;
    const timer = setTimeout(async () => {
      await store.saveFullJar("stale", withPsidts(freshFullJar(), rotated));
    }, 20);

    const ctx = {
      verbose: false,
      cookieSession: session,
      listProfiles: deps.listProfiles,
    } as unknown as CliCommandContext;

    const result = await resolveProfile(ctx, "c_x", "stale");
    clearTimeout(timer);

    expect(result).toBe("stale");
    expect(deps.spawnRefreshRunner).toHaveBeenCalledTimes(1);
    expect(deps.spawnRefreshRunner).toHaveBeenCalledWith("stale");
    expect(session.rotationInFlight("stale")).toBe(false);
    expect(psidtsValue((await store.load("stale")).cookies)).toBe(rotated);
  });

  test("explicit fresh profile short-circuits the wait and never spawns", async () => {
    const store = new CookieStore();
    await store.saveFullJar("fresh", freshFullJar());
    const { session, deps } = await makeArmedSession(store, { stale: false, profileName: "fresh" });

    const ctx = {
      verbose: false,
      cookieSession: session,
      listProfiles: deps.listProfiles,
    } as unknown as CliCommandContext;

    const result = await resolveProfile(ctx, "c_x", "fresh");

    expect(result).toBe("fresh");
    expect(deps.spawnRefreshRunner).not.toHaveBeenCalled();
  });

  test("unknown explicit profile fails fast without arming", async () => {
    const store = new CookieStore();
    await store.saveFullJar("real", freshFullJar());
    const { session, deps } = await makeArmedSession(store, { stale: true, profileName: "real" });

    const ctx = {
      verbose: false,
      cookieSession: session,
      listProfiles: deps.listProfiles,
    } as unknown as CliCommandContext;

    await expect(resolveProfile(ctx, "c_x", "missing")).rejects.toThrow(/configured profile/);
    expect(deps.spawnRefreshRunner).not.toHaveBeenCalled();
  });
});
