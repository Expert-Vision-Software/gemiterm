// Invariant: a rejected chats probe is a transport verdict, not a session
// verdict (gh#25). The classifier must never flatten a probeChats rejection
// into `phantom` — the historical behavior misclassified valid sessions on
// header-overflow/timeout/5xx environments and lured users into pointless
// recovery rotations. `unreachable` carries the cause on the result; the
// canonical live/phantom/dead vocabulary (and `dead` detection via the init
// HTML fetch) is unchanged.
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { SessionClassifier, type SessionProbeResult } from "../../src/auth/session-classifier.ts";
import { createCookieSession } from "../../src/auth/cookie-session.ts";
import { freshFullJar } from "./fixtures.ts";
import { TEST_DIR, setupIsolation, teardownIsolation } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const TOKEN_HTML = '<html><body>{"SNlM0e":"tok","cfb2h":"x","FdrFJe":"y"}</body></html>';
const PROBE_ERROR = new Error("HPE_HEADER_OVERFLOW");

function classifierFor(html: string | Error, chats: unknown[] | Error) {
  return new SessionClassifier({
    fetchInitHtml: mock(async () => {
      if (html instanceof Error) throw html;
      return html;
    }),
    probeChats: mock(async () => {
      if (chats instanceof Error) throw chats;
      return chats;
    }),
  });
}

async function seedJar(): Promise<void> {
  await new CookieStore().saveFullJar("test-profile", freshFullJar());
}

function jarPath(): string {
  return join(TEST_DIR, "profiles", "test-profile", "storage_state.json");
}

describe("auth-regression: probe error is not phantom (gh#25)", () => {
  test("rejecting probeChats -> unreachable with the captured error, never phantom", async () => {
    await seedJar();
    const result = await classifierFor(TOKEN_HTML, PROBE_ERROR).classifyDetailed("test-profile");
    expect(result).toEqual({ state: "unreachable", chatCount: 0, error: PROBE_ERROR });
    expect(result.state).not.toBe("phantom");
  });

  test("classify() rejects on unreachable so callers apply their own fallback", async () => {
    await seedJar();
    await expect(classifierFor(TOKEN_HTML, PROBE_ERROR).classify("test-profile")).rejects.toBe(
      PROBE_ERROR,
    );
  });

  test("phantom and dead verdicts are unchanged (empty chats / failed init fetch)", async () => {
    await seedJar();
    const phantom = await classifierFor(TOKEN_HTML, []).classifyDetailed("test-profile");
    expect(phantom).toEqual({ state: "phantom", chatCount: 0 });
    expect(phantom.error).toBeUndefined();

    const dead = await classifierFor(new Error("init fetch down"), []).classifyDetailed("test-profile");
    expect(dead).toEqual({ state: "dead", chatCount: 0 });
  });

  test("facade wiring: a rejecting probe client surfaces unreachable through probeDetailed", async () => {
    await seedJar();
    const listChats = mock(async () => {
      throw PROBE_ERROR;
    });
    const session = createCookieSession({
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
      listProfiles: async () => ["test-profile"],
      spawnRefreshRunner: () => {},
      createProbeClient: async () => ({ listChats }),
    });

    const detailed: SessionProbeResult = await session.probeDetailed("test-profile");
    expect(detailed.state).toBe("unreachable");
    expect(detailed.error).toBe(PROBE_ERROR);
    await expect(session.probe("test-profile")).rejects.toBe(PROBE_ERROR);
    // Non-live for routing purposes: transport failures must not count as
    // active profiles (same exclusion the historical phantom verdict had).
    expect(await session.activeProfiles()).toEqual([]);
  });

  test("probe purity holds on the unreachable path: the jar is untouched", async () => {
    await seedJar();
    const bytesBefore = readFileSync(jarPath(), "utf-8");
    const session = createCookieSession({
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never,
      listProfiles: async () => ["test-profile"],
      spawnRefreshRunner: () => {},
      createProbeClient: async () => ({ listChats: mock(async () => { throw PROBE_ERROR; }) }),
    });

    await session.probeDetailed("test-profile");

    expect(readFileSync(jarPath(), "utf-8")).toBe(bytesBefore);
  });
});
