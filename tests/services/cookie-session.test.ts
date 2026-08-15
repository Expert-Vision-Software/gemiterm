import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  CookieSession,
  sessionExpiry,
  type CookieRotator,
  type CookieValidation,
} from "../../src/services/cookie-session.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { AuthenticationError } from "../../src/core/errors.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";

const NOW = Date.parse("2026-08-15T00:00:00Z");
const DAY = 24 * 60 * 60;
const PSID = "__Secure-1PSID";
const PSIDTS = "__Secure-1PSIDTS";

function cookie(name: string, value: string, expires: number, extra: Partial<Cookie> = {}): Cookie {
  return {
    name,
    value,
    domain: ".google.com",
    path: "/",
    expires,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...extra,
  };
}

function makeStalePair(now = NOW): Cookie[] {
  return [
    cookie(PSID, "psid-value", Math.floor(now / 1000) + 365 * DAY),
    cookie(PSIDTS, "psidts-value", Math.floor(now / 1000) + 3 * DAY),
  ];
}

function makeFreshPair(now = NOW): Cookie[] {
  return [
    cookie(PSID, "psid-value", Math.floor(now / 1000) + 365 * DAY),
    cookie(PSIDTS, "psidts-value", Math.floor(now / 1000) + 365 * DAY),
  ];
}

function makeUntrackedPair(now = NOW): Cookie[] {
  return [
    cookie(PSID, "psid-value", Math.floor(now / 1000) + 365 * DAY),
    cookie(PSIDTS, "psidts-value", Math.floor(now / 1000) + 365 * DAY),
    cookie("NID", "nid-value", Math.floor(now / 1000) + 30 * DAY, { httpOnly: false }),
  ];
}

class MemoryStorage implements CookieStorage {
  store = new Map<string, Cookie[]>();

  save(profileName: string, cookies: Cookie[]): void {
    this.store.set(profileName, cookies.map((c) => ({ ...c })));
  }

  load(profileName: string): Cookie[] {
    const cookies = this.store.get(profileName);
    if (!cookies) {
      throw new Error(
        `No storage state found for profile '${profileName}'. Run 'gemiterm auth' to authenticate.`,
      );
    }
    return cookies.map((c) => ({ ...c }));
  }

  delete(profileName: string): void {
    this.store.delete(profileName);
  }

  list(): string[] {
    return [...this.store.keys()];
  }
}

interface Harness {
  session: CookieSession;
  storage: MemoryStorage;
  now: () => number;
  setNow: (ms: number) => void;
  rotator: CookieRotator;
  rotateMock: ReturnType<typeof mock>;
}

function buildHarness(opts: { rotationEnabled?: boolean; now?: number } = {}): Harness {
  const storage = new MemoryStorage();
  let nowValue = opts.now ?? NOW;
  const setNow = (ms: number) => {
    nowValue = ms;
  };
  const rotateMock = mock(async () => null as string | null);
  const rotator: CookieRotator = { rotate: rotateMock as unknown as CookieRotator["rotate"] };
  const session = new CookieSession({
    cookieStorage: storage,
    logger: new Logger("test"),
    clock: () => nowValue,
    rotator,
    rotationEnabled: opts.rotationEnabled ?? false,
  });
  return { session, storage, now: () => nowValue, setNow, rotator, rotateMock };
}

describe("CookieSession.validate", () => {
  test("both tiers pass for a fresh pair", () => {
    const { session } = buildHarness();
    const v = session.validate(makeFreshPair());
    expect(v.hasPrimary).toBe(true);
    expect(v.hasSecondary).toBe(true);
    expect(v.fresh).toBe(true);
  });

  test("stale PSIDTS is recoverable, not terminal", () => {
    const { session } = buildHarness();
    const v = session.validate(makeStalePair());
    expect(v.hasPrimary).toBe(true);
    expect(v.hasSecondary).toBe(true);
    expect(v.fresh).toBe(false);
  });

  test("missing primary binding is terminal", () => {
    const { session } = buildHarness();
    const v = session.validate([cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 365 * DAY)]);
    expect(v.hasPrimary).toBe(false);
    expect(v.fresh).toBe(true);
  });

  test("session-cookie PSIDTS (expires -1) is fresh", () => {
    const { session } = buildHarness();
    const v = session.validate([
      cookie(PSID, "sid", -1),
      cookie(PSIDTS, "ts", -1),
    ]);
    expect(v.hasPrimary).toBe(true);
    expect(v.hasSecondary).toBe(true);
    expect(v.fresh).toBe(true);
    expect(v.expiresAt).toBeNull();
  });
});

describe("CookieSession 7-day threshold via fake clock", () => {
  test("advancing the clock past the threshold flips fresh to stale", () => {
    const { session, setNow } = buildHarness();
    const cookies = [
      cookie(PSID, "sid", Math.floor(NOW / 1000) + 365 * DAY),
      cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 8 * DAY),
    ];
    expect(session.validate(cookies).fresh).toBe(true);

    setNow(NOW + 2 * DAY * 1000);
    expect(session.validate(cookies).fresh).toBe(false);
  });

  test("expiry threshold is exactly 7 days out from the clock", () => {
    const { session, setNow } = buildHarness();
    setNow(NOW);
    const cookies = [
      cookie(PSID, "sid", Math.floor(NOW / 1000) + 365 * DAY),
      cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 7 * DAY),
    ];
    expect(session.validate(cookies).fresh).toBe(true);

    setNow(NOW + 1000);
    expect(session.validate(cookies).fresh).toBe(false);
  });
});

describe("expiry computation", () => {
  test("expiry is the max across tracked cookies", () => {
    const psid = Math.floor(NOW / 1000) + 30 * DAY;
    const ts = Math.floor(NOW / 1000) + 10 * 60;
    const expiry = sessionExpiry([cookie(PSID, "sid", psid), cookie(PSIDTS, "ts", ts)]);
    expect(expiry).not.toBeNull();
    expect(expiry!.getTime()).toBe(psid * 1000);
  });

  test("no positive expiry yields null", () => {
    expect(sessionExpiry([cookie(PSID, "sid", -1), cookie(PSIDTS, "ts", -1)])).toBeNull();
    expect(sessionExpiry([])).toBeNull();
  });
});

describe("CookieSession.ensureSession", () => {
  test("resolves a valid persisted session without writes", async () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeFreshPair());
    const saveSpy = mock(storage.save.bind(storage));

    const result = await session.ensureSession("default");
    expect(result.secure1psid).toBe("psid-value");
    expect(result.secure1psidts).toBe("psidts-value");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("throws AuthenticationError naming the binding when PSID is missing", async () => {
    const { session, storage } = buildHarness();
    storage.save("default", [cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 365 * DAY)]);

    await expect(session.ensureSession("default")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(session.ensureSession("default")).rejects.toThrow(PSID);
    await expect(session.ensureSession("default")).rejects.toThrow("gemiterm auth");
  });

  test("throws AuthenticationError naming PSIDTS when it is stale (rotation disabled)", async () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeStalePair());

    await expect(session.ensureSession("default")).rejects.toThrow(PSIDTS);
    await expect(session.ensureSession("default")).rejects.toThrow("default");
  });

  test("missing storage surfaces the load error", async () => {
    const { session } = buildHarness();
    await expect(session.ensureSession("ghost")).rejects.toThrow("No storage state found");
  });

  test("absorb rescues a stale session without network", async () => {
    const { session, storage, rotateMock } = buildHarness({ rotationEnabled: true });
    storage.save("default", makeStalePair());
    const freshTs = cookie(PSIDTS, "fresh-ts", Math.floor(NOW / 1000) + 365 * DAY);

    const result = await session.ensureSession("default", { [PSIDTS]: "fresh-ts" });

    expect(result.secure1psidts).toBe("fresh-ts");
    expect(rotateMock).not.toHaveBeenCalled();
    expect(storage.load("default").find((c) => c.name === PSIDTS)?.value).toBe("fresh-ts");
  });

  test("disabled rotation degrades to the actionable error without POST", async () => {
    const { session, rotateMock } = buildHarness({ rotationEnabled: false });
    (session as unknown as { cookieStorage: CookieStorage }).cookieStorage.save("default", makeStalePair());

    await expect(session.ensureSession("default")).rejects.toThrow("gemiterm auth");
    expect(rotateMock).not.toHaveBeenCalled();
  });

  test("enabled rotation recovers a stale session from the rotated PSIDTS", async () => {
    const { session, storage, rotateMock } = buildHarness({ rotationEnabled: true });
    storage.save("default", makeStalePair());
    rotateMock.mockResolvedValueOnce("rotated-ts");

    const result = await session.ensureSession("default");

    expect(rotateMock).toHaveBeenCalledTimes(1);
    expect(result.secure1psidts).toBe("rotated-ts");
    expect(storage.load("default").find((c) => c.name === PSIDTS)?.value).toBe("rotated-ts");
  });

  test("failed rotation falls through to the error and leaves disk untouched", async () => {
    const { session, storage, rotateMock } = buildHarness({ rotationEnabled: true });
    storage.save("default", makeStalePair());
    const before = storage.load("default").map((c) => ({ ...c }));
    rotateMock.mockResolvedValueOnce(null);

    await expect(session.ensureSession("default")).rejects.toThrow("gemiterm auth");
    expect(storage.load("default")).toEqual(before);
  });

  test("a working session is never subjected to rotation", async () => {
    const { session, storage, rotateMock } = buildHarness({ rotationEnabled: true });
    storage.save("default", makeFreshPair());

    const result = await session.ensureSession("default");
    expect(result.secure1psid).toBe("psid-value");
    expect(rotateMock).not.toHaveBeenCalled();
  });
});

describe("CookieSession.commit (capture mode)", () => {
  test("stamps tracked expiry to now + 7 days and preserves untracked metadata", () => {
    const { session, storage } = buildHarness();
    const captured = [
      cookie(PSID, "sid", Math.floor(NOW / 1000) + 600, { httpOnly: false, sameSite: "None" }),
      cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 600),
      cookie("NID", "nid", Math.floor(NOW / 1000) + 30 * DAY),
    ];

    const stamped = session.commit("default", captured);

    const expected = Math.floor((NOW + 7 * DAY * 1000) / 1000);
    expect(stamped.find((c) => c.name === PSID)?.expires).toBe(expected);
    expect(stamped.find((c) => c.name === PSIDTS)?.expires).toBe(expected);
    expect(stamped.find((c) => c.name === PSID)?.httpOnly).toBe(false);
    expect(stamped.find((c) => c.name === "NID")?.expires).toBe(captured[2].expires);
  });

  test("rejects a PSID-less capture and leaves disk untouched", () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeFreshPair());
    const before = storage.load("default").map((c) => ({ ...c }));

    expect(() => session.commit("default", [cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 600)])).toThrow(
      "retry 'gemiterm auth'",
    );
    expect(storage.load("default")).toEqual(before);
  });

  test("skips the write when the capture is unchanged", () => {
    const { session, storage } = buildHarness();
    const captured = makeFreshPair();
    session.commit("default", captured);
    const before = storage.load("default");
    const saveSpy = mock(storage.save.bind(storage));

    session.commit("default", captured);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(storage.load("default")).toEqual(before);
  });
});

describe("CookieSession.commit (jar-merge mode)", () => {
  test("overlays the jar onto matching names preserving metadata and untracked names", () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeUntrackedPair());
    const beforeTs = storage.load("default").find((c) => c.name === PSIDTS)!;

    session.commit("default", { jar: { [PSIDTS]: "new-ts" } });

    const saved = storage.load("default");
    const ts = saved.find((c) => c.name === PSIDTS)!;
    expect(ts.value).toBe("new-ts");
    expect(ts.domain).toBe(beforeTs.domain);
    expect(ts.path).toBe(beforeTs.path);
    expect(ts.httpOnly).toBe(beforeTs.httpOnly);
    expect(ts.secure).toBe(beforeTs.secure);
    expect(ts.sameSite).toBe(beforeTs.sameSite);
    expect(saved.find((c) => c.name === PSID)?.value).toBe("psid-value");
    expect(saved.find((c) => c.name === "NID")?.value).toBe("nid-value");
  });

  test("no write when the jar changes nothing", () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeFreshPair());
    const before = storage.load("default");
    const saveSpy = mock(storage.save.bind(storage));

    session.commit("default", { jar: { [PSID]: "psid-value", [PSIDTS]: "psidts-value" } });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(storage.load("default")).toEqual(before);
  });

  test("invalid merge (loses PSID) throws and leaves disk untouched", () => {
    const { session, storage } = buildHarness();
    storage.save("default", [cookie(PSIDTS, "ts", Math.floor(NOW / 1000) + 365 * DAY)]);
    const before = storage.load("default").map((c) => ({ ...c }));

    expect(() => session.commit("default", { jar: { [PSIDTS]: "other" } })).toThrow();
    expect(storage.load("default")).toEqual(before);
  });
});

describe("CookieSession.sessionStatus", () => {
  test("returns invalid (no throw) for missing or unreadable storage", () => {
    const { session } = buildHarness();
    expect(session.sessionStatus("ghost").loaded).toBe(false);
  });

  test("returns valid status for a fresh profile", () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeFreshPair());
    const status = session.sessionStatus("default");
    expect(status.loaded).toBe(true);
    expect(status.hasPrimary).toBe(true);
    expect(status.fresh).toBe(true);
    expect(status.expiresAt).not.toBeNull();
  });

  test("returns fresh=false for a stale profile", () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeStalePair());
    const status = session.sessionStatus("default");
    expect(status.fresh).toBe(false);
  });

  test("active is true for a fresh profile and false for a stale profile", () => {
    const { session, storage } = buildHarness();
    storage.save("default", makeFreshPair());
    expect(session.sessionStatus("default").active).toBe(true);
    storage.save("stale", makeStalePair());
    expect(session.sessionStatus("stale").active).toBe(false);
    expect(session.sessionStatus("ghost").active).toBe(false);
  });
});

describe("CookieSession.validate exposed for loadCookiesForApi mapping", () => {
  test("returns extracted pair and expiry for a loaded array", () => {
    const { session } = buildHarness();
    const v: CookieValidation = session.validate(makeFreshPair());
    expect(v.secure1psid).toBe("psid-value");
    expect(v.secure1psidts).toBe("psidts-value");
    expect(v.expiresAt).not.toBeNull();
  });
});
