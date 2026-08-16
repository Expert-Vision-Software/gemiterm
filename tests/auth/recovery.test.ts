import { describe, test, expect, mock } from "bun:test";
import type { Cookie } from "../../src/core/types.ts";
import { RecoveryRung } from "../../src/auth/recovery.ts";
import { AuthenticationError } from "../../src/core/errors.ts";

function cookie(name: string, value: string): Cookie {
  return {
    name,
    value,
    domain: ".google.com",
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

const ARMED = {
  secure_1psid: "psid",
  secure_1psidts: "ts",
  cookies: [cookie("__Secure-1PSID", "psid"), cookie("__Secure-1PSIDTS", "ts")],
};

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    refresher: { rotatePsidts: mock(async () => ({ rotated: true, cookies: ARMED.cookies })) },
    cookieStore: {
      load: mock(async () => ({ cookies: [cookie("__Secure-1PSIDTS", "on-disk-ts")], snapshot: new Map() })),
    },
    rearm: mock(async () => ARMED),
    logger: makeLogger(),
    ...overrides,
  };
}

describe("RecoveryRung", () => {
  test("successful rotation re-arms once and resolves", async () => {
    const deps = makeDeps();
    const rung = new RecoveryRung(deps as never);

    const result = await rung.recover("p");

    expect(result.secure_1psid).toBe("psid");
    expect(deps.refresher.rotatePsidts).toHaveBeenCalledTimes(1);
    expect(deps.refresher.rotatePsidts).toHaveBeenCalledWith("p", "on-disk-ts");
    expect(deps.rearm).toHaveBeenCalledTimes(1);
    expect(deps.rearm).toHaveBeenCalledWith("p");
  });

  test("rotation failure retries nothing and throws AuthenticationError", async () => {
    const deps = makeDeps({
      refresher: { rotatePsidts: mock(async () => ({ rotated: false })) },
    });
    const rung = new RecoveryRung(deps as never);

    await expect(rung.recover("p")).rejects.toBeInstanceOf(AuthenticationError);
    expect(deps.refresher.rotatePsidts).toHaveBeenCalledTimes(1);
    expect(deps.rearm).not.toHaveBeenCalled();
  });

  test("re-arm failure surfaces AuthenticationError without a second refresh", async () => {
    const deps = makeDeps({
      rearm: mock(async () => {
        throw new AuthenticationError("still broken");
      }),
    });
    const rung = new RecoveryRung(deps as never);

    await expect(rung.recover("p")).rejects.toBeInstanceOf(AuthenticationError);
    expect(deps.refresher.rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("non-auth re-arm failures map to AuthenticationError", async () => {
    const deps = makeDeps({
      rearm: mock(async () => {
        throw new Error("rearm exploded");
      }),
    });
    const rung = new RecoveryRung(deps as never);

    await expect(rung.recover("p")).rejects.toBeInstanceOf(AuthenticationError);
    expect(deps.refresher.rotatePsidts).toHaveBeenCalledTimes(1);
  });

  test("refresh exceptions map to AuthenticationError", async () => {
    const deps = makeDeps({
      refresher: {
        rotatePsidts: mock(async () => {
          throw new Error("browser gone");
        }),
      },
    });
    const rung = new RecoveryRung(deps as never);

    await expect(rung.recover("p")).rejects.toBeInstanceOf(AuthenticationError);
  });
});
