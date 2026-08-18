// Invariant: the keepalive loop records the POST-rotation PSIDTS as its
// baseline (fix-5-audit-remediations). The bug: `tick()` recorded the
// pre-rotation disk value, so after the first rotation every 10-minute tick
// re-spawned the browser forever (the no-op fast path was unreachable).
// Driven against the real CookieStore (on-disk truth) with a fake refresher
// that actually persists a new PSIDTS — the fake mutation is the audit's
// exact repro of why the original tests passed vacuously.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { SessionKeepalive } from "../../src/auth/session-keepalive.ts";
import { RotationCooldown } from "../../src/auth/rotation-cooldown.ts";
import { freshFullJar } from "./fixtures.ts";
import { setupIsolation, teardownIsolation, makeLogger, withPsidts, psidtsValue } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

describe("auth-regression: keepalive baseline", () => {
  test("post-rotation PSIDTS becomes the baseline; the next in-interval tick skips the refresher", async () => {
    const store = new CookieStore();
    await store.saveFullJar("p", freshFullJar());

    const rotatedJar = withPsidts(freshFullJar(), "rotated-ts");
    const rotatePsidts = mock(async () => {
      await store.saveFullJar("p", rotatedJar);
      return { rotated: true, cookies: rotatedJar };
    });
    let time = 0;

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher: { rotatePsidts },
      cooldown: new RotationCooldown({ now: () => time }),
      logger: makeLogger() as never,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);
    expect(psidtsValue((await store.load("p")).cookies)).toBe("rotated-ts");

    time += 120_000;
    await keepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("a rotation result without a cookie jar re-reads the store for the baseline", async () => {
    const store = new CookieStore();
    await store.saveFullJar("p", freshFullJar());

    const rotatedJar = withPsidts(freshFullJar(), "rotated-no-jar");
    const rotatePsidts = mock(async () => {
      await store.saveFullJar("p", rotatedJar);
      return { rotated: true };
    });
    let time = 0;

    const keepalive = new SessionKeepalive("p", {
      cookieStore: store,
      refresher: { rotatePsidts },
      cooldown: new RotationCooldown({ now: () => time }),
      logger: makeLogger() as never,
      now: () => time,
      setInterval: () => ({ unref: () => {} }),
    });

    await keepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);

    time += 120_000;
    await keepalive.tick();
    expect(rotatePsidts).toHaveBeenCalledTimes(1);
  });
});
