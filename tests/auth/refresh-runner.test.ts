import { describe, test, expect, mock } from "bun:test";
import { runRefresh } from "../../src/auth/refresh-runner.ts";

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe("runRefresh", () => {
  test("uses the on-disk PSIDTS as baseline and logs rotation outcome", async () => {
    const logger = makeLogger();
    const refresher = {
      rotatePsidts: mock(async (profile: string, baseline: string | null) => {
        expect(profile).toBe("p");
        expect(baseline).toBe("on-disk-ts");
        return { rotated: true };
      }),
    };
    const store = {
      load: mock(async () => ({
        cookies: [{ name: "__Secure-1PSIDTS", value: "on-disk-ts" }],
        snapshot: new Map(),
      })),
    };

    const result = await runRefresh("p", { refresher: refresher as never, cookieStore: store as never, logger: logger as never });

    expect(result.rotated).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("rotated=true"));
  });

  test("missing jar degrades to null baseline and still runs", async () => {
    const logger = makeLogger();
    const refresher = {
      rotatePsidts: mock(async (_p: string, baseline: string | null) => {
        expect(baseline).toBeNull();
        return { rotated: false };
      }),
    };
    const store = {
      load: mock(async () => {
        throw new Error("No storage state found");
      }),
    };

    const result = await runRefresh("p", { refresher: refresher as never, cookieStore: store as never, logger: logger as never });

    expect(result.rotated).toBe(false);
  });

  test("refresh failures are logged, never thrown", async () => {
    const logger = makeLogger();
    const refresher = {
      rotatePsidts: mock(async () => {
        throw new Error("browser exploded");
      }),
    };
    const store = {
      load: mock(async () => ({ cookies: [], snapshot: new Map() })),
    };

    const result = await runRefresh("p", { refresher: refresher as never, cookieStore: store as never, logger: logger as never });

    expect(result.rotated).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("browser exploded"));
  });
});
