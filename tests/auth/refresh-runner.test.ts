import { describe, test, expect, mock } from "bun:test";
import { existsSync } from "node:fs";
import {
  runRefresh,
  refreshRunnerEntryPath,
  spawnDetachedRefreshRunner,
} from "../../src/auth/refresh-runner.ts";
import type { RunnerLock } from "../../src/auth/refresh-runner-lock.ts";
import {
  getConfigDir,
  getLogFilePath,
  resolvePath,
} from "../../src/infrastructure/path-utils.ts";

function openLock(): RunnerLock {
  return { tryAcquire: mock(async () => true), release: mock(async () => {}) };
}

describe("refreshRunnerEntryPath", () => {
  test("resolves to the actual refresh-runner.ts file next to the module", () => {
    const normalized = refreshRunnerEntryPath().replaceAll("\\", "/");
    expect(normalized.endsWith("src/auth/refresh-runner.ts")).toBe(true);
    expect(existsSync(refreshRunnerEntryPath())).toBe(true);
  });
});

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
    const releaseLock = mock(async () => {});
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

    const result = await runRefresh("p", { refresher: refresher as never, cookieStore: store as never, logger: logger as never, releaseLock });

    expect(result.rotated).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("starting"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("rotated=true"));
    expect(releaseLock).toHaveBeenCalledWith("p");
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

    const result = await runRefresh("p", { refresher: refresher as never, cookieStore: store as never, logger: logger as never, releaseLock: mock(async () => {}) });

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

    const result = await runRefresh("p", { refresher: refresher as never, cookieStore: store as never, logger: logger as never, releaseLock: mock(async () => {}) });

    expect(result.rotated).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("browser exploded"));
  });
});

interface SpawnCapture {
  cmd: string[];
  opts: {
    stdin: unknown;
    stdout: unknown;
    stderr: unknown;
    detached: unknown;
    windowsHide: unknown;
    env: Record<string, string | undefined>;
  };
}

describe("spawnDetachedRefreshRunner", () => {
  test("spawns detached with stdout+stderr on the config-dir log fd and an absolute GEMITERM_CONFIG_DIR", async () => {
    const openedPaths: string[] = [];
    const spawns: SpawnCapture[] = [];
    await spawnDetachedRefreshRunner("p", {
      lock: openLock(),
      openLogFd: (path) => {
        openedPaths.push(path);
        return 77;
      },
      spawn: (cmd, opts) => {
        spawns.push({ cmd, opts: opts as unknown as SpawnCapture["opts"] });
        return { exited: Promise.resolve(0) };
      },
    });

    expect(openedPaths).toEqual([getLogFilePath()]);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].cmd).toEqual([process.execPath, refreshRunnerEntryPath(), "p"]);
    expect(spawns[0].opts.detached).toBe(true);
    expect(spawns[0].opts.stdin).toBe("ignore");
    expect(spawns[0].opts.stdout).toBe(77);
    expect(spawns[0].opts.stderr).toBe(77);
    expect(spawns[0].opts.windowsHide).toBe(true);
    expect(spawns[0].opts.env.GEMITERM_CONFIG_DIR).toBe(resolvePath(getConfigDir()));
  });

  test("falls back to ignored stdio when the log fd cannot be opened", async () => {
    const spawns: SpawnCapture[] = [];
    await spawnDetachedRefreshRunner("p", {
      lock: openLock(),
      openLogFd: () => {
        throw new Error("cannot open log");
      },
      spawn: (cmd, opts) => {
        spawns.push({ cmd, opts: opts as unknown as SpawnCapture["opts"] });
        return { exited: Promise.resolve(0) };
      },
    });

    expect(spawns).toHaveLength(1);
    expect(spawns[0].opts.detached).toBe(true);
    expect(spawns[0].opts.windowsHide).toBe(true);
    expect(spawns[0].opts.stdout).toBe("ignore");
    expect(spawns[0].opts.stderr).toBe("ignore");
  });

  test("skips the spawn when a fresh single-flight lock is held", async () => {
    const spawns: SpawnCapture[] = [];
    await spawnDetachedRefreshRunner("p", {
      lock: { tryAcquire: mock(async () => false), release: mock(async () => {}) },
      openLogFd: () => 77,
      spawn: (cmd, opts) => {
        spawns.push({ cmd, opts: opts as unknown as SpawnCapture["opts"] });
        return { exited: Promise.resolve(0) };
      },
    });

    expect(spawns).toHaveLength(0);
  });

  test("releases the lock when the spawn itself throws", async () => {
    const lock = openLock();
    await spawnDetachedRefreshRunner("p", {
      lock,
      openLogFd: () => 77,
      spawn: () => {
        throw new Error("no exec");
      },
    });

    expect(lock.release).toHaveBeenCalledWith("p");
  });
});
