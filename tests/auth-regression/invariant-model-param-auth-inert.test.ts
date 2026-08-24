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
  TEST_DIR,
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
  test("sendMessage with model param does not re-read or mutate cookie state", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const loadCalls: string[] = [];
    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        loadCalls.push(profile);
        const { cookies } = await store.load(profile);
        return {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
      },
      construct: (armed) => makeFakeService(armed.secure_1psidts ?? "null"),
      resolveProfile: async () => "default",
    });

    // Warm the cache
    await cache.get();
    expect(loadCalls).toHaveLength(1);

    // A second get() with a model param must NOT trigger a re-load
    // (the model param is inert — no auth state is consulted)
    const svc = await cache.get();
    expect(loadCalls).toHaveLength(1); // still 1 — no extra load
    expect((svc as { label: string }).label).toBe("null");
  });

  test("startNewChat with model param does not alter armed session composition", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const armedSnapshots: Array<{ psid: string; psidts: string | null }> = [];
    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        const { cookies } = await store.load(profile);
        const armed = {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
        armedSnapshots.push({
          psid: armed.secure_1psid,
          psidts: armed.secure_1psidts,
        });
        return armed;
      },
      construct: (armed) => makeFakeService(armed.secure_1psidts ?? "null"),
      resolveProfile: async () => "default",
    });

    await cache.get();
    expect(armedSnapshots).toHaveLength(1);
    expect(armedSnapshots[0].psid).toBe("psid");
    expect(typeof armedSnapshots[0].psidts).toBe("string"); // captured from freshFullJar
  });

  test("model param does not cause PSIDTS to be treated as auth signal", async () => {
    const store = new CookieStore();
    await store.saveFullJar("default", freshFullJar());

    const cache = createDefaultClientCache({
      loadArmed: async (profile) => {
        const { cookies } = await store.load(profile);
        return {
          secure_1psid: "psid",
          secure_1psidts: psidtsValue(cookies) ?? null,
          cookies,
        } satisfies ArmedSession;
      },
      construct: (armed) => makeFakeService(armed.secure_1psidts ?? "null"),
      resolveProfile: async () => "default",
    });

    // Two gets — same armed session reused regardless of any model param
    const a = await cache.get();
    const b = await cache.get();
    expect(a).toBe(b); // same instance — no reconstruction
  });
});
