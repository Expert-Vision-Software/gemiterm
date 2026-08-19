// Invariant: findProfileForConversation consults stale-armed profiles after
// their rotation lands. Field repro (DHBGAMING2, 2026-08-18): the user's
// `continue -p <stale>` conversation owned only by a stale profile failed to
// resolve — the facade iterated live profiles only. Drives the real
// CookieSession + CookieStore (on-disk truth); rotation is simulated via
// side-write.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { freshFullJar } from "./fixtures.ts";
import {
  TEST_DIR,
  setupIsolation,
  teardownIsolation,
  makeSessionDeps,
  makeSession,
  withPsidts,
} from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const STALE_MTIME = () => new Date(Date.now() - 45 * 60 * 1000);

describe("auth-regression: findProfileForConversation stale-aware second pass", () => {
  test("returns the stale-armed profile when its rotation lands and owns the conversation", async () => {
    const store = new CookieStore();
    await store.saveFullJar("stale", freshFullJar());

    let rotationLanded = false;
    const profileHasConversation = mock(async (profile: string, _cid: string) => {
      if (profile === "stale" && rotationLanded) return true;
      return false;
    });

    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Parameters<CookieStore["saveFullJar"]>[1]) =>
          store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      conversationLookup: { profileHasConversation },
      listProfiles: mock(async () => ["stale"]),
      rotationWaitMs: 5_000,
    });
    deps.classifier.classify = mock(async () => "phantom" as const);

    const session = makeSession(deps);

    await session.ensureSession("stale");
    expect(session.rotationInFlight("stale")).toBe(true);

    const timer = setTimeout(async () => {
      rotationLanded = true;
      await store.saveFullJar("stale", withPsidts(freshFullJar(), `rotated-${Date.now()}`));
    }, 20);

    const owner = await session.findProfileForConversation("c_x");
    clearTimeout(timer);

    expect(owner).toBe("stale");
    expect(profileHasConversation).toHaveBeenCalledWith("stale", "c_x");
    expect(session.rotationInFlight("stale")).toBe(false);
  });

  test("live pass keeps priority over a stale-armed owner", async () => {
    const store = new CookieStore();
    await store.saveFullJar("live", freshFullJar());
    await store.saveFullJar("stale", freshFullJar());

    const profileHasConversation = mock(async (profile: string, _cid: string) => {
      if (profile === "live") return true;
      return false;
    });

    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Parameters<CookieStore["saveFullJar"]>[1]) =>
          store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      conversationLookup: { profileHasConversation },
      listProfiles: mock(async () => ["live", "stale"]),
      rotationWaitMs: 5_000,
    });
    deps.classifier.classify = mock(async (name: string) =>
      name === "live" ? ("live" as const) : ("phantom" as const),
    );

    const session = makeSession(deps);

    await session.ensureSession("live");
    await session.ensureSession("stale");
    expect(session.rotationInFlight("stale")).toBe(true);

    const owner = await session.findProfileForConversation("c_x");

    expect(owner).toBe("live");
    expect(profileHasConversation).toHaveBeenCalledTimes(1);
    expect(profileHasConversation).toHaveBeenCalledWith("live", "c_x");
  });

  test("returns null when no live pass nor stale-armed pass owns the conversation", async () => {
    const store = new CookieStore();
    await store.saveFullJar("stale", freshFullJar());

    const profileHasConversation = mock(async () => false);

    const deps = makeSessionDeps({
      cookieStore: {
        load: (p: string) => store.load(p),
        saveFullJar: (p: string, c: Parameters<CookieStore["saveFullJar"]>[1]) =>
          store.saveFullJar(p, c),
        getJarMtime: async () => STALE_MTIME(),
      },
      conversationLookup: { profileHasConversation },
      listProfiles: mock(async () => ["stale"]),
      rotationWaitMs: 20,
    });
    deps.classifier.classify = mock(async () => "phantom" as const);

    const session = makeSession(deps);

    await session.ensureSession("stale");

    const owner = await session.findProfileForConversation("c_x");

    expect(owner).toBeNull();
  });
});
