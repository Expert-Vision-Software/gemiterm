// Shared harness for the auth-regression suite (fix-4).
// Owns the per-file GEMITERM_CONFIG_DIR bootstrap (D6: no imports from the
// global mock-cookie fixtures) and the common fakes injected through the
// existing DI surfaces. Assert against on-disk truth, never return values
// alone (design.md D1).
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { mock } from "bun:test";
import type { Cookie } from "../../src/core/types.ts";
import { CookieSession } from "../../src/auth/cookie-session.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { CookieValidator } from "../../src/auth/cookie-validation.ts";

export const TEST_DIR = join(tmpdir(), "gemiterm-auth-regression");

const origLog = console.log;

export function setupIsolation(): void {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "profiles"), { recursive: true });
  // Capture/login flows print UI chatter; keep the suite output focused.
  console.log = () => {};
}

export function teardownIsolation(): void {
  console.log = origLog;
  delete process.env.GEMITERM_CONFIG_DIR;
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Windows file-lock races during cleanup are not test failures.
  }
}

export function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

/** Returns a copy of `jar` with every `__Secure-1PSIDTS` cookie set to `value`. */
export function withPsidts(jar: Cookie[], value: string): Cookie[] {
  return jar.map((c) => (c.name === "__Secure-1PSIDTS" ? { ...c, value } : c));
}

export function psidtsValue(jar: Cookie[]): string | undefined {
  return jar.find((c) => c.name === "__Secure-1PSIDTS")?.value;
}

/** Fake capture driver offering `cookies` on every poll/state read. */
export function makeDriver(cookies: Cookie[]) {
  return {
    openHeaded: mock(async () => {}),
    openHeadless: mock(async () => {}),
    cookieList: mock(async () => cookies),
    cookieListFromState: mock(async () => cookies),
    closeSession: mock(async () => {}),
  };
}

export function makeSessionDeps(overrides: Record<string, unknown> = {}) {
  const cookieStore = new CookieStore();
  const deps = {
    cookieStore,
    validator: new CookieValidator({ logger: makeLogger() as never }),
    refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
    cooldown: new RotationCooldown(),
    classifier: {
      classify: mock(async () => "live" as const),
      classifyDetailed: mock(async () => ({ state: "live" as const, chatCount: 1 })),
    },
    recovery: {
      recover: mock(async () => {
        throw new Error("recovery fake: not expected in this test");
      }),
    },
    logger: makeLogger(),
    spawnRefreshRunner: mock(() => {}),
    listProfiles: mock(async () => ["p"]),
    conversationLookup: { profileHasConversation: mock(async () => false) },
    driver: makeDriver([]),
    pollIntervalMs: 5,
  };
  return { ...deps, ...overrides } as typeof deps;
}

export function makeSession(deps: ReturnType<typeof makeSessionDeps>): CookieSession {
  return new CookieSession(deps as never);
}

/** A fake refresher shaped like BrowserRefresher that persists through the real store. */
export function persistingRefresher(cookieStore: CookieStore, nextJar: () => Cookie[]) {
  const calls: string[] = [];
  return {
    calls,
    rotatePsidts: mock(async (profile: string, _baseline: string | null) => {
      calls.push(profile);
      await cookieStore.saveFullJar(profile, nextJar(), new Map());
      return { rotated: true };
    }),
  };
}