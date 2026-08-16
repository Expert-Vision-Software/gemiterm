// Invariant: full-jar capture integrity + PSIDTS rotation propagation (fix-4 tasks 2.1-2.3).
// Historical classes: H6/REQUIRED_COOKIES name-filter, discarded rotation,
// save-on-login-page. Asserts on the on-disk storage_state.json artifact.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { RecoveryRung } from "../../src/auth/recovery.ts";
import { freshFullJar, trimmedFourCookieJar } from "./fixtures.ts";
import {
  TEST_DIR,
  setupIsolation,
  teardownIsolation,
  makeDriver,
  makeLogger,
  makeSessionDeps,
  makeSession,
  persistingRefresher,
  psidtsValue,
  withPsidts,
} from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const jarPath = (profile: string) => join(TEST_DIR, "profiles", profile, "storage_state.json");

describe("auth-regression: full-jar capture integrity", () => {
  test("capture persists every offered cookie; no name-subset filter can reduce it", async () => {
    const fullJar = freshFullJar();
    const persisted: Cookie[][] = [];
    const cookieStore = new CookieStore();
    const originalSave = cookieStore.saveFullJar.bind(cookieStore);
    cookieStore.saveFullJar = async (profile, cookies) => {
      persisted.push(cookies);
      return originalSave(profile, cookies);
    };

    const deps = makeSessionDeps({ cookieStore, driver: makeDriver(fullJar) });
    await makeSession(deps).captureLogin("test-profile");

    // Every offered cookie name reached the persist call...
    const saved = persisted[0] ?? [];
    expect(new Set(saved.map((c) => c.name))).toEqual(new Set(fullJar.map((c) => c.name)));
    expect(saved.length).toBe(fullJar.length);
    // ...and every offered cookie is on disk, grouped by name.
    const disk = JSON.parse(readFileSync(jarPath("test-profile"), "utf-8")).cookies as Cookie[];
    expect(new Set(disk.map((c) => c.name))).toEqual(new Set(fullJar.map((c) => c.name)));
    expect(disk.length).toBe(fullJar.length);
  });

  test("trimmed 4-cookie jar is captured as-is (historical artifact)", async () => {
    const trimmedJar = trimmedFourCookieJar();
    const deps = makeSessionDeps({ driver: makeDriver(trimmedJar) });
    await makeSession(deps).captureLogin("test-profile");

    const disk = JSON.parse(readFileSync(jarPath("test-profile"), "utf-8")).cookies as Cookie[];
    expect(disk.length).toBe(4);
    for (const c of disk) {
      expect(["__Secure-1PSID", "__Secure-1PSIDTS"]).toContain(c.name);
      expect([".google.com", ".youtube.com"]).toContain(c.domain);
    }
  });
});

describe("auth-regression: PSIDTS rotation propagation", () => {
  test("facade refresh() propagates the rotated PSIDTS value to disk", async () => {
    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", freshFullJar());
    const rotatedValue = `rotated-psidts-${Date.now()}`;
    const refresher = persistingRefresher(cookieStore, () => withPsidts(freshFullJar(), rotatedValue));

    const deps = makeSessionDeps({ cookieStore, refresher, cooldown: new RotationCooldown() });
    const result = await makeSession(deps).refresh("test-profile");

    expect(result.rotated).toBe(true);
    expect(psidtsValue(JSON.parse(readFileSync(jarPath("test-profile"), "utf-8")).cookies)).toBe(rotatedValue);
  });

  test("recovery rung propagates the refreshed PSIDTS value to disk", async () => {
    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", freshFullJar());
    const recoveredValue = `recovered-psidts-${Date.now()}`;
    const refresher = persistingRefresher(cookieStore, () => withPsidts(freshFullJar(), recoveredValue));

    // Real RecoveryRung; fakes only at the refresher seam (design.md D1).
    const recovery = new RecoveryRung({
      refresher,
      cookieStore,
      rearm: async (profile) => {
        const { cookies } = await cookieStore.load(profile);
        return { secure_1psid: "psid", secure_1psidts: psidtsValue(cookies) ?? null, cookies };
      },
      logger: makeLogger(),
    });

    const armed = await recovery.recover("test-profile");
    expect(armed.secure_1psidts).toBe(recoveredValue);
    expect(psidtsValue(JSON.parse(readFileSync(jarPath("test-profile"), "utf-8")).cookies)).toBe(recoveredValue);
  });
});

describe("auth-regression: signed-out capture safety", () => {
  const anonymousJar = (): Cookie[] => [
    {
      name: "CONSENT",
      value: "YES",
      domain: ".google.com",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 86400,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ];

  test("no write on anonymous-cookie capture (gate never passes; no state read)", async () => {
    const driver = makeDriver(anonymousJar());
    const deps = makeSessionDeps({ driver });

    // timeoutMs keeps the gate poll short — the invariant is "no persist", fast-fail is fine.
    await expect(makeSession(deps).captureLogin("test-profile", { timeoutMs: 50 })).rejects.toThrow();
    expect(driver.cookieListFromState).not.toHaveBeenCalled();
    expect(await new CookieStore().getJarMtime("test-profile")).toBeNull();
  });

  test("pre-existing jar is byte-unchanged on signed-out capture attempt", async () => {
    const cookieStore = new CookieStore();
    await cookieStore.saveFullJar("test-profile", freshFullJar());
    const bytesBefore = readFileSync(jarPath("test-profile"), "utf-8");

    const deps = makeSessionDeps({ cookieStore, driver: makeDriver(anonymousJar()) });
    await expect(makeSession(deps).captureLogin("test-profile", { timeoutMs: 50 })).rejects.toThrow();

    expect(readFileSync(jarPath("test-profile"), "utf-8")).toBe(bytesBefore);
  });
});