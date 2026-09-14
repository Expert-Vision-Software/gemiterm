// Invariant: the live/phantom/dead session-state vocabulary has a single
// source of truth (fix-8 review), extended by issue 25 with the probe-only
// "unreachable" state: `SessionState` (src/core/types.ts) stays the canonical
// {live, phantom, dead} declaration for output formatting; `SessionProbeResult`
// (src/auth/session-classifier.ts) may additionally report "unreachable" when
// the chats probe itself errored (never a phantom conversion), and
// `AuthenticationError.sessionState` (src/core/errors.ts) shares that widened
// union. The compile-time checks below pin both consumers to the widened
// type; the runtime checks pin the emitted values to exactly
// {live, phantom, dead, unreachable}.
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
const EXPECTED_PROBE_STATES = [...EXPECTED_STATES, "unreachable"] as const;

// Compile-time drift guards (fail the type-check whenever a consumer
// re-declares or narrows the vocabulary instead of importing the core type
// plus the issue-25 "unreachable" extension).
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type ProbeState = SessionProbeResult["state"];
type ErrorState = NonNullable<AuthenticationError["sessionState"]>;
type _ProbeStateIsCorePlusUnreachable = Expect<Equals<ProbeState, SessionState | "unreachable">>;
type _ErrorStateIsCorePlusUnreachable = Expect<Equals<ErrorState, SessionState | "unreachable">>;

// Bidirectional assignment checks: a value of the core type flows into both
// consumer positions, and consumer-typed values flow back into the core type
// (after narrowing away "unreachable").
const coreState: SessionState = "phantom";
const coreAsProbe: ProbeState = coreState;
const coreAsError: ErrorState = coreState;
function probeAsCore(state: ProbeState): SessionState {
  return state === "unreachable" ? "dead" : state;
}
function errorAsCore(state: ErrorState): SessionState {
  return state === "unreachable" ? "dead" : state;
}

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
    expect(probeAsCore("phantom")).toBe("phantom");
    expect(errorAsCore("phantom")).toBe("phantom");
  });

  test("AuthenticationError round-trips every canonical state and the unreachable extension", () => {
    for (const state of EXPECTED_PROBE_STATES) {
      const err = new AuthenticationError("probe", { sessionState: state });
      if (err.sessionState === undefined) {
        throw new Error(`AuthenticationError dropped sessionState '${state}'`);
      }
      expect(err.sessionState).toBe(state);
      expect(EXPECTED_PROBE_STATES).toContain(err.sessionState);
    }
  });

  test("classifier emits exactly the canonical state set plus unreachable across its truth table", async () => {
    await seedJar();

    const dead = await classifierFor(new Error("network down"), []).classifyDetailed("test-profile");
    const phantom = await classifierFor(ONE_NON_EMPTY, []).classifyDetailed("test-profile");
    const live = await classifierFor(ONE_NON_EMPTY, [{ id: "c1" }]).classifyDetailed("test-profile");
    const unreachable = await new SessionClassifier({
      fetchInitHtml: mock(async () => ONE_NON_EMPTY),
      probeChats: mock(async () => {
        throw new Error("transport failure");
      }),
    }).classifyDetailed("test-profile");

    const states = [dead.state, phantom.state, live.state, unreachable.state];
    for (const state of states) {
      expect(EXPECTED_PROBE_STATES).toContain(state);
    }
    expect(new Set(states)).toEqual(new Set(EXPECTED_PROBE_STATES));
  });

  test("unreachable never masquerades as phantom (issue 25): a rejected probe carries error, chatCount 0", async () => {
    await seedJar();
    const boom = new Error("HPE_HEADER_OVERFLOW");
    const classifier = new SessionClassifier({
      fetchInitHtml: mock(async () => ONE_NON_EMPTY),
      probeChats: mock(async () => {
        throw boom;
      }),
    });
    const result = await classifier.classifyDetailed("test-profile");
    expect(result).toEqual({ state: "unreachable", chatCount: 0, error: boom });
    expect(result.state).not.toBe("phantom");
  });
});
