// Invariant: the session-state vocabulary has a single source of truth
// (fix-8 review; extended by gh#25). `SessionState` (src/core/types.ts) is
// the canonical declaration; `AuthenticationError.sessionState`
// (src/core/errors.ts) and `SessionProbeResult.state`
// (src/auth/session-classifier.ts) share the probe vocabulary
// `SessionState | "unreachable"` — never a re-declared union. "unreachable"
// is transport-only (gh#25): it is a property of the probe, not of the
// session, and the core live/phantom/dead triple stays unchanged for output
// formatting. The compile-time checks below pin both consumers to that
// relationship in both directions; the runtime checks pin the emitted
// values.
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
const PROBE_STATES = ["live", "phantom", "dead", "unreachable"] as const;

// Compile-time drift guards (fail the type-check whenever a consumer
// re-declares or diverges from the shared vocabulary).
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type _CoreStateUnchanged = Expect<Equals<SessionState, "live" | "phantom" | "dead">>;
type _ProbeStateIsCorePlusUnreachable = Expect<Equals<SessionProbeResult["state"], SessionState | "unreachable">>;
type _ErrorStateIsCorePlusUnreachable = Expect<Equals<NonNullable<AuthenticationError["sessionState"]>, SessionState | "unreachable">>;

// Bidirectional assignment checks: the core triple flows into both consumer
// positions, and any probe state (including "unreachable") flows into the
// error position.
const coreState: SessionState = "phantom";
const coreAsProbe: SessionProbeResult["state"] = coreState;
const coreAsError: NonNullable<AuthenticationError["sessionState"]> = coreState;
const probeAsError: NonNullable<AuthenticationError["sessionState"]> = "unreachable" as SessionProbeResult["state"];

async function seedJar(): Promise<void> {
  await new CookieStore().saveFullJar("test-profile", freshFullJar());
}

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
    expect(probeAsError).toBe("unreachable");
  });

  test("AuthenticationError round-trips every canonical state and the transport state", () => {
    for (const state of [...EXPECTED_STATES, "unreachable" as const]) {
      const err = new AuthenticationError("probe", { sessionState: state });
      if (err.sessionState === undefined) {
        throw new Error(`AuthenticationError dropped sessionState '${state}'`);
      }
      expect(err.sessionState).toBe(state);
      expect(PROBE_STATES).toContain(err.sessionState);
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

  test("the only state outside the canonical triple is unreachable, and only for a rejected probe", async () => {
    await seedJar();

    const unreachable = await classifierFor(ONE_NON_EMPTY, new Error("network down")).classifyDetailed("test-profile");
    expect(unreachable.state).toBe("unreachable");
    for (const state of EXPECTED_STATES) {
      expect(unreachable.state).not.toBe(state);
    }
    expect(unreachable.error).toBeInstanceOf(Error);
  });
});
