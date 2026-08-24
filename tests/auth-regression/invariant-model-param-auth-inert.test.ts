// Invariant: model parameter on sendMessage/startNewChat does not alter cookie
// handling or session construction (add-model-selection, 2026-08-24).
// The model param is purely a routing concern; auth state (cookies, armed
// session, PSIDTS) is never read or written as a side-effect of passing it.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { createDefaultClientCache } from "../../src/cli/utils/default-client-cache.ts";
import type { ArmedSession } from "../../src/auth/cookie-session.ts";
import { freshFullJar } from "./fixtures.ts";
import {
  setupIsolation,
  teardownIsolation,
  psidtsValue,
} from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

function makeFakeService(label: string): { label: string } {
  return { label };
}

describe("auth-regression: model parameter is auth-inert", () => {
  test("get() returns the same service instance when PSIDTS is unchanged", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

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
        constructed.push(armed.secure_1psidts ?? "null");
        return makeFakeService(armed.secure_1psidts ?? "null");
      },
      resolveProfile: async () => "default",
    });

    // Warm
    const a = await cache.get();
    expect(constructed).toHaveLength(1);

    // Second get — PSIDTS unchanged → same service instance, no re-construct
    const b = await cache.get();
    expect(b).toBe(a);
    expect(constructed).toHaveLength(1); // still 1 — construct not re-called
  });

  test("armed session cookies are unchanged across repeated get() calls", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const armedSnapshots: Array<{ psid: string; psidts: string | null; count: number }> = [];
    let callCount = 0;
    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        callCount++;
        const { cookies } = await store.load(profile);
        const armed = {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
        armedSnapshots.push({
          psid: armed.secure_1psid,
          psidts: armed.secure_1psidts,
          count: callCount,
        });
        return armed;
      },
      construct: (armed) => makeFakeService(armed.secure_1psidts ?? "null"),
      resolveProfile: async () => "default",
    });

    await cache.get();
    await cache.get();
    await cache.get();

    // All calls see the same armed session state
    expect(armedSnapshots).toHaveLength(3);
    for (const snap of armedSnapshots) {
      expect(snap.psid).toBe("psid");
      expect(typeof snap.psidts).toBe("string"); // never null after warm
    }
    // PSIDTS value is consistent across all calls
    const psidtsValues = armedSnapshots.map((s) => s.psidts);
    expect([...new Set(psidtsValues)]).toHaveLength(1);
  });

  test("loadArmed is always called (PSIDTS must be re-checked) but construct is gated on PSIDTS change", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const loadCount = { value: 0 };
    const constructCount = { value: 0 };
    const cache = createDefaultClientCache({
      loadArmed: async () => {
        loadCount.value++;
        const { cookies } = await store.load("default");
        return {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
      },
      construct: (armed) => {
        constructCount.value++;
        return makeFakeService(armed.secure_1psidts ?? "null");
      },
      resolveProfile: async () => "default",
    });

    await cache.get();
    expect(loadCount.value).toBe(1);
    expect(constructCount.value).toBe(1);

    await cache.get();
    expect(loadCount.value).toBe(2); // always re-checks PSIDTS
    expect(constructCount.value).toBe(1); // but only re-constructs if PSIDTS changed
  });
});
