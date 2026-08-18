import { describe, test, expect, mock, spyOn, afterEach } from "bun:test";
import { runWithRotationRetry } from "../../../src/cli/utils/rotation-await.ts";

function makeCookieSession(overrides: {
  rotationInFlight?: ReturnType<typeof mock>;
  waitForRotation?: ReturnType<typeof mock>;
} = {}) {
  return {
    rotationInFlight: overrides.rotationInFlight ?? mock(() => false),
    waitForRotation: overrides.waitForRotation ?? mock(async () => null),
  };
}

describe("runWithRotationRetry", () => {
  afterEach(() => {
    mock.restore();
  });

  test("happy path returns the result without consulting rotation state", async () => {
    const cookieSession = makeCookieSession();
    const operation = mock(async () => 42);

    const result = await runWithRotationRetry(cookieSession as never, "p", operation, () => false);

    expect(result).toBe(42);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(cookieSession.rotationInFlight).not.toHaveBeenCalled();
    expect(cookieSession.waitForRotation).not.toHaveBeenCalled();
  });

  test("throw with no rotation in flight rethrows the original error", async () => {
    const cookieSession = makeCookieSession();
    const operation = mock(async () => {
      throw new Error("auth failed");
    });

    await expect(
      runWithRotationRetry(cookieSession as never, "p", operation, () => false),
    ).rejects.toThrow("auth failed");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(cookieSession.rotationInFlight).toHaveBeenCalledTimes(1);
    expect(cookieSession.waitForRotation).not.toHaveBeenCalled();
  });

  test("empty result with a landed rotation retries once and returns the retried value", async () => {
    const cookieSession = makeCookieSession({
      rotationInFlight: mock(() => true),
      waitForRotation: mock(async () => ({ cookies: [] })),
    });
    let calls = 0;
    const operation = mock(async () => {
      calls += 1;
      return calls === 1 ? [] : ["recovered"];
    });

    const result = await runWithRotationRetry(
      cookieSession as never,
      "p",
      operation,
      (r) => (r as unknown[]).length === 0,
    );

    expect(result).toEqual(["recovered"]);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
  });

  test("throw with a landed rotation retries once", async () => {
    const cookieSession = makeCookieSession({
      rotationInFlight: mock(() => true),
      waitForRotation: mock(async () => ({ cookies: [] })),
    });
    let calls = 0;
    const operation = mock(async () => {
      calls += 1;
      if (calls === 1) throw new Error("auth failed");
      return "ok";
    });

    const result = await runWithRotationRetry(cookieSession as never, "p", operation, () => false);

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test("timeout returns the failed result, prints the hint, and never retries", async () => {
    const cookieSession = makeCookieSession({
      rotationInFlight: mock(() => true),
      waitForRotation: mock(async () => null),
    });
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const operation = mock(async () => [] as string[]);

    try {
      const result = await runWithRotationRetry(
        cookieSession as never,
        "p",
        operation,
        (r) => r.length === 0,
      );

      expect(result).toEqual([]);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(cookieSession.waitForRotation).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls.map((c) => c[0]).join("\n")).toContain("still in progress");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("timeout after a throw rethrows the original error", async () => {
    const cookieSession = makeCookieSession({
      rotationInFlight: mock(() => true),
      waitForRotation: mock(async () => null),
    });
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const operation = mock(async () => {
      throw new Error("auth failed");
    });

    try {
      await expect(
        runWithRotationRetry(cookieSession as never, "p", operation, () => false),
      ).rejects.toThrow("auth failed");
      expect(operation).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  test("preserves non-Error throw values", async () => {
    const cookieSession = makeCookieSession();
    const operation = mock(async () => {
      throw "string-failure";
    });

    await expect(
      runWithRotationRetry(cookieSession as never, "p", operation, () => false),
    ).rejects.toBe("string-failure");
  });
});
