// Invariant: the process-cached default GeminiClientService is reconstructed
// when the on-disk PSIDTS changes (fix-8, gap 4). Field repro (DHBGAMING2,
// 2026-08-18 12:37): `fetch c_3c69396e3d6127a4` waited, rotation observed at
// 12:37:30, retry printed `No messages found.`; the identical command 10s
// later (fresh process, fresh arm) rendered the full conversation. Drives
// the cache helper against a real CookieStore + side-write rotation.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { createDefaultClientCache } from "../../src/cli/utils/default-client-cache.ts";
import type { ArmedSession } from "../../src/auth/cookie-session.ts";
import { freshFullJar } from "./fixtures.ts";
import {
  TEST_DIR,
  setupIsolation,
  teardownIsolation,
  psidtsValue,
  withPsidts,
} from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

function makeFakeService(label: string): { label: string } {
  return { label };
}

describe("auth-regression: default client revalidation", () => {
  test("unchanged PSIDTS keeps the cached instance", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const constructed: string[] = [];
    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        const { cookies } = await store.load(profile);
        const psidts = psidtsValue(cookies) ?? null;
        return {
          secure_1psid: "psid",
          secure_1psidts: psidts,
          cookies,
        } satisfies ArmedSession;
      },
      construct: (armed) => {
        constructed.push(armed.secure_1psidts ?? "null");
        return makeFakeService(armed.secure_1psidts ?? "null");
      },
      resolveProfile: async () => "default",
    });

    const a = await cache.get();
    const b = await cache.get();
    const c = await cache.get();

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(constructed).toHaveLength(1);
  });

  test("changed PSIDTS reconstructs the client in the same process", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        const { cookies } = await store.load(profile);
        const psidts = psidtsValue(cookies) ?? null;
        return {
          secure_1psid: "psid",
          secure_1psidts: psidts,
          cookies,
        } satisfies ArmedSession;
      },
      construct: mock((armed: ArmedSession) => makeFakeService(armed.secure_1psidts ?? "null")) as never,
      resolveProfile: async () => "default",
    });

    const first = await cache.get();

    const rotated = `rotated-${Date.now()}`;
    await store.saveFullJar("default", withPsidts(freshFullJar(), rotated));

    const second = await cache.get();

    expect(second).not.toBe(first);
  });

  test("null PSIDTS counts as a fresh value — first call constructs, second call with same null reuses", async () => {
    const noPsidtsJar = freshFullJar().filter((c) => c.name !== "__Secure-1PSIDTS");
    const store = new CookieStore();
    await store.saveFullJar("default", noPsidtsJar);

    const constructed: string[] = [];
    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        const { cookies } = await store.load(profile);
        return {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
      },
      construct: (armed) => {
        constructed.push(String(armed.secure_1psidts));
        return makeFakeService(String(armed.secure_1psidts));
      },
      resolveProfile: async () => "default",
    });

    const a = await cache.get();
    const b = await cache.get();

    expect(a).toBe(b);
    expect(constructed).toHaveLength(1);
  });

  test("gap 4 repro: stale-armed first, rotation lands on disk, retried call uses refreshed client", async () => {
    const store = new CookieStore();
    const baseline = withPsidts(freshFullJar(), "baseline-stale");
    await store.saveFullJar("default", baseline);

    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        const { cookies } = await store.load(profile);
        return {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
      },
      construct: mock((armed: ArmedSession) => makeFakeService(armed.secure_1psidts ?? "null")) as never,
      resolveProfile: async () => "default",
    });

    const first = await cache.get();

    await store.saveFullJar("default", withPsidts(freshFullJar(), "post-rotation"));
    const second = await cache.get();

    expect(second).not.toBe(first);
    expect((second as { label: string }).label).toBe("post-rotation");
    expect((first as { label: string }).label).toBe("baseline-stale");
  });
});
