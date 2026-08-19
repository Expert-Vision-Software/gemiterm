// Invariant: classifier truth table + probe purity (fix-4 tasks 2.6-2.7).
// The classifier is read-only: it writes nothing and fires no rotation.
// Probe-purity is asserted through the CookieSession facade so a future
// "probe also rotates" regression cannot go unobserved (constant-ok guard).
import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { SessionClassifier } from "../../src/auth/session-classifier.ts";
import { freshFullJar } from "./fixtures.ts";
import {
  TEST_DIR,
  setupIsolation,
  teardownIsolation,
  makeLogger,
  makeSessionDeps,
  makeSession,
} from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const TOKEN_HTML = '<html><body>{"SNlM0e":"tok","cfb2h":"x","FdrFJe":"y"}</body></html>';
const SIGNED_OUT_HTML = "<html><body><p>Sign in to continue</p></body></html>";

function classifierFor(html: string, chats: unknown[]) {
  return new SessionClassifier({
    fetchInitHtml: mock(async () => html),
    probeChats: mock(async () => chats),
  });
}

async function seedJar(): Promise<void> {
  await new CookieStore().saveFullJar("test-profile", freshFullJar());
}

describe("auth-regression: classifier truth table", () => {
  test("live: tokens present + listChats >= 1", async () => {
    await seedJar();
    const result = await classifierFor(TOKEN_HTML, ["chat1", "chat2"]).classifyDetailed("test-profile");
    expect(result).toEqual({ state: "live", chatCount: 2 });
  });

  test("phantom: tokens present + listChats 0", async () => {
    await seedJar();
    const result = await classifierFor(TOKEN_HTML, []).classifyDetailed("test-profile");
    expect(result).toEqual({ state: "phantom", chatCount: 0 });
  });

  test("dead: no init tokens (probeChats never called)", async () => {
    await seedJar();
    const probeChats = mock(async () => ["chat1"]);
    const classifier = new SessionClassifier({ fetchInitHtml: mock(async () => SIGNED_OUT_HTML), probeChats });
    expect(await classifier.classify("test-profile")).toBe("dead");
    expect(probeChats).not.toHaveBeenCalled();
  });

  test("deterministic across repeated runs on the same jar shape", async () => {
    await seedJar();
    const classifier = classifierFor(TOKEN_HTML, ["chat1"]);
    const results = await Promise.all([
      classifier.classify("test-profile"),
      classifier.classify("test-profile"),
      classifier.classify("test-profile"),
    ]);
    expect(results).toEqual(["live", "live", "live"]);
  });
});

describe("auth-regression: probe purity", () => {
  test("probe writes nothing and fires no rotation (facade-level)", async () => {
    await seedJar();
    const jarPath = join(TEST_DIR, "profiles", "test-profile", "storage_state.json");
    const bytesBefore = readFileSync(jarPath, "utf-8");

    const rotateCalls: string[] = [];
    const deps = makeSessionDeps({
      refresher: {
        rotatePsidts: mock(async (profile: string) => {
          rotateCalls.push(profile);
          return { rotated: true };
        }),
      },
    });
    const session = makeSession(deps);

    // probe() must route to the read-only classifier, not refresh().
    expect(await session.probe("test-profile")).toBe("live");
    expect(rotateCalls.length).toBe(0);
    expect(readFileSync(jarPath, "utf-8")).toBe(bytesBefore);
  });
});