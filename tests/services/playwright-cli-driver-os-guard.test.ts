// Cross-OS profile guard (docs/auth-cookie-lifecycle.md §4.3 device continuity,
// field evidence 2026-09-15/16): a profile's Chromium user-data dir is bound to
// the OS browser that created it; opening it with the other OS's Chromium wipes
// the browser-side auth cookies. The driver MUST refuse to spawn a browser for
// a profile whose OS marker names a different platform.
import { describe, test, expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileOsMismatchError } from "../../src/core/errors.ts";
import {
  FsProfileOsMarker,
  PlaywrightCliDriver,
  type PlaywrightRunner,
} from "../../src/services/playwright-cli-driver.ts";

function fakeRunner(): PlaywrightRunner & { _run: ReturnType<typeof mock> } {
  const _run = mock(async (_args: string[]) => ({ exitCode: 0, stdout: "", stderr: "" }));
  return {
    strategy: "direct",
    _run,
    async run(args) {
      return _run(args);
    },
    spawnDetached: () => {},
  };
}

function fakeMarker(content: string | null, opts: { claimThrows?: Error } = {}) {
  const claims: string[] = [];
  return {
    claims,
    read: mock(async (_dir: string) => content),
    claim: mock(async (_dir: string, platform: string) => {
      if (opts.claimThrows) throw opts.claimThrows;
      claims.push(platform);
    }),
  };
}

function driverWith(runner: PlaywrightRunner, marker: unknown, platform: string): PlaywrightCliDriver {
  return new PlaywrightCliDriver({
    runner,
    profileOsMarker: marker as never,
    platformDetector: () => platform,
  });
}

describe("PlaywrightCliDriver cross-OS profile guard", () => {
  test("openHeaded throws ProfileOsMismatchError before any spawn on marker mismatch", async () => {
    const runner = fakeRunner();
    const marker = fakeMarker("linux");
    const d = driverWith(runner, marker, "win32");

    try {
      await d.openHeaded("https://gemini.google.com/app", "diag-fix1", "s1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileOsMismatchError);
      const msg = (err as Error).message;
      expect(msg).toContain("diag-fix1");
      expect(msg).toContain("linux");
      expect(msg).toContain("win32");
      expect(msg).toContain("GEMITERM_CONFIG_DIR");
      expect(msg).toContain("gemiterm auth");
    }
    expect(runner._run).not.toHaveBeenCalled();
  });

  test("openHeadless throws ProfileOsMismatchError before any spawn on marker mismatch", async () => {
    const runner = fakeRunner();
    const marker = fakeMarker("win32");
    const d = driverWith(runner, marker, "linux");

    try {
      await d.openHeadless("https://gemini.google.com/app", "p1", "s1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileOsMismatchError);
    }
    expect(runner._run).not.toHaveBeenCalled();
  });

  test("matching marker proceeds to spawn", async () => {
    const runner = fakeRunner();
    const marker = fakeMarker("win32");
    const d = driverWith(runner, marker, "win32");

    await d.openHeadless("https://gemini.google.com/app", "p1", "s1");

    expect(runner._run).toHaveBeenCalledTimes(1);
    expect(marker.claim).not.toHaveBeenCalled();
  });

  test("absent marker claims the current platform and proceeds", async () => {
    const runner = fakeRunner();
    const marker = fakeMarker(null);
    const d = driverWith(runner, marker, "win32");

    await d.openHeaded("https://gemini.google.com/app", "p1", "s1");

    expect(marker.claim).toHaveBeenCalledWith(expect.stringContaining("p1"), "win32");
    expect(runner._run).toHaveBeenCalledTimes(1);
  });

  test("claim io failure is logged and does not block auth", async () => {
    const runner = fakeRunner();
    const warns: string[] = [];
    const logger = { warn: (m: string) => warns.push(m) } as Console;
    const marker = fakeMarker(null, { claimThrows: new Error("disk full") });
    const d = new PlaywrightCliDriver({
      runner,
      logger,
      profileOsMarker: marker as never,
      platformDetector: () => "win32",
    });

    await d.openHeadless("https://gemini.google.com/app", "p1", "s1");

    expect(runner._run).toHaveBeenCalledTimes(1);
    expect(warns.join("\n")).toContain("browser-os.marker");
  });

  test("unreadable marker (read throws) is treated as absent: claim and proceed", async () => {
    const runner = fakeRunner();
    const marker = {
      read: mock(async (_dir: string) => {
        throw new Error("EACCES");
      }),
      claim: mock(async (_dir: string, _p: string) => {}),
    };
    const d = driverWith(runner, marker, "win32");

    await d.openHeaded("https://gemini.google.com/app", "p1", "s1");

    expect(marker.claim).toHaveBeenCalled();
    expect(runner._run).toHaveBeenCalledTimes(1);
  });
});

describe("FsProfileOsMarker", () => {
  const parent = mkdtempSync(join(tmpdir(), "gemiterm-os-marker-"));

  test("missing marker reads as null; claim writes the platform", async () => {
    const dir = join(parent, "fresh");
    const marker = new FsProfileOsMarker();

    expect(await marker.read(dir)).toBeNull();
    await marker.claim(dir, "linux");
    expect(await marker.read(dir)).toBe("linux");
    expect(readFileSync(join(dir, "browser-os.marker"), "utf-8")).toBe("linux");
  });

  test("corrupt marker content reads as null (claimable, never a mismatch)", async () => {
    const dir = join(parent, "corrupt");
    const marker = new FsProfileOsMarker();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "browser-os.marker"), "\x00\x01partial-write-garbage", "utf-8");

    expect(await marker.read(dir)).toBeNull();
  });

  test("empty marker content reads as null", async () => {
    const dir = join(parent, "empty");
    const marker = new FsProfileOsMarker();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "browser-os.marker"), "", "utf-8");

    expect(await marker.read(dir)).toBeNull();
  });
});
