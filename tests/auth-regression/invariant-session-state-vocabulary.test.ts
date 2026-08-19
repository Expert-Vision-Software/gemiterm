// Invariant: the live/phantom/dead session-state vocabulary has a single
// source of truth (fix-8 review). `SessionState` (src/core/types.ts) is the
// canonical declaration; `AuthenticationError.sessionState`
// (src/core/errors.ts) and `SessionProbeResult.state`
// (src/auth/session-classifier.ts) must share that type, never re-declare
// the union. The compile-time checks below pin both consumers to the core
// type in both directions; the runtime checks pin the emitted values to
// exactly {live, phantom, dead}.
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { SessionState } from "../../src/core/types.ts";
import { AuthenticationError } from "../../src/core/errors.ts";
import { SessionClassifier, type SessionProbeResult } from "../../src/auth/session-classifier.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { freshFullJar } from "./fixtures.ts";
import { setupIsolation, teardownIsolation } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const EXPECTED_STATES = ["live", "phantom", "dead"] as const;

// Compile-time drift guards (fail the type-check whenever a consumer
// re-declares or widens the vocabulary instead of importing the core type).
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type _ProbeStateIsCoreState = Expect<Equals<SessionState, SessionProbeResult["state"]>>;
type _ErrorStateIsCoreState = Expect<Equals<SessionState, NonNullable<AuthenticationError["sessionState"]>>>;

// Bidirectional assignment checks: a value of the core type flows into both
// consumer positions, and consumer-typed values flow back into the core type.
const coreState: SessionState = "phantom";
const coreAsProbe: SessionProbeResult["state"] = coreState;
const coreAsError: NonNullable<AuthenticationError["sessionState"]> = coreState;
const probeAsCore: SessionState = coreAsProbe;
const errorAsCore: SessionState = coreAsError;

async function seedJar(): Promise<void> {
  await new CookieStore().saveFullJar("test-profile", freshFullJar());
}

function classifierFor(html: string | Error, chats: unknown[]) {
  return new SessionClassifier({
    fetchInitHtml: mock(async () => {
      if (html instanceof Error) throw html;
      return html;
    }),
    probeChats: mock(async () => chats),
  });
}

// One required token with a non-empty extracted value (mirrors the token-
// values invariant): sufficient to proceed to the chats probe.
const ONE_NON_EMPTY = [
  "window.WIZ_global_data = {",
  '"SNlM0e":"abc123",',
  '"cfb2h":"",',
  '"FdrFJe":"",',
  "};",
].join("");

describe("auth-regression: session-state vocabulary", () => {
  test("compile-time assignment checks hold the shared vocabulary at runtime values", () => {
    expect(coreAsProbe).toBe("phantom");
    expect(coreAsError).toBe("phantom");
    expect(probeAsCore).toBe("phantom");
    expect(errorAsCore).toBe("phantom");
  });

  test("AuthenticationError round-trips every canonical state", () => {
    for (const state of EXPECTED_STATES) {
      const err = new AuthenticationError("probe", { sessionState: state });
      if (err.sessionState === undefined) {
        throw new Error(`AuthenticationError dropped sessionState '${state}'`);
      }
      expect(err.sessionState).toBe(state);
      expect(EXPECTED_STATES).toContain(err.sessionState);
    }
  });

  test("classifier emits exactly the canonical state set across its truth table", async () => {
    await seedJar();

    const dead = await classifierFor(new Error("network down"), []).classifyDetailed("test-profile");
    const phantom = await classifierFor(ONE_NON_EMPTY, []).classifyDetailed("test-profile");
    const live = await classifierFor(ONE_NON_EMPTY, [{ id: "c1" }]).classifyDetailed("test-profile");

    const states = [dead.state, phantom.state, live.state];
    for (const state of states) {
      expect(EXPECTED_STATES).toContain(state);
    }
    expect(new Set(states)).toEqual(new Set(EXPECTED_STATES));
  });
});
