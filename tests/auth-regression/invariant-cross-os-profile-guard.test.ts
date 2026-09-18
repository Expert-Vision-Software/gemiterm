// Invariant: cross-OS profile guard (docs/auth-cookie-lifecycle.md §4.3 device
// continuity, field evidence 2026-09-15/16). A profile's Chromium user-data dir
// doubles as device identity AND browser-side session storage; running the
// other OS's Chromium against it wipes the auth cookies (only anonymous cookies
// remained, so every later rotation failed). The driver's two browser-opening
// methods (openHeaded = capture, openHeadless = rotation) MUST refuse to spawn
// when the profile's OS marker names a different platform than the running
// process — in either direction, before any subprocess is launched.
import { describe, test, expect, mock } from "bun:test";
import { ProfileOsMismatchError } from "../../src/core/errors.ts";
import {
  PlaywrightCliDriver,
  type PlaywrightRunner,
} from "../../src/services/playwright-cli-driver.ts";

function neverSpawnRunner(): PlaywrightRunner {
  return {
    run: mock(async (_args: string[]) => {
      throw new Error("INVARIANT VIOLATION: browser spawn reached with a cross-OS marker");
    }),
    spawnDetached: mock((_args: string[]) => {
      throw new Error("INVARIANT VIOLATION: detached spawn reached with a cross-OS marker");
    }),
  };
}

function markerStub(content: string) {
  return {
    read: async (_dir: string) => content,
    claim: async (_dir: string, _platform: string) => {},
  };
}

describe("auth-regression: cross-OS profile guard", () => {
  test("linux marker on a win32 process can never reach the headed spawn", async () => {
    const runner = neverSpawnRunner();
    const d = new PlaywrightCliDriver({
      runner,
      profileOsMarker: markerStub("linux") as never,
      platformDetector: () => "win32",
    });

    try {
      await d.openHeaded("https://gemini.google.com/app", "p", "p");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileOsMismatchError);
      expect((err as Error).message).toContain("linux");
      expect((err as Error).message).toContain("win32");
    }
  });

  test("linux marker on a win32 process can never reach the headless spawn", async () => {
    const runner = neverSpawnRunner();
    const d = new PlaywrightCliDriver({
      runner,
      profileOsMarker: markerStub("linux") as never,
      platformDetector: () => "win32",
    });

    try {
      await d.openHeadless("https://gemini.google.com/app", "p", "p");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileOsMismatchError);
    }
  });

  test("win32 marker on a linux process can never reach the headed spawn", async () => {
    const runner = neverSpawnRunner();
    const d = new PlaywrightCliDriver({
      runner,
      profileOsMarker: markerStub("win32") as never,
      platformDetector: () => "linux",
    });

    try {
      await d.openHeaded("https://gemini.google.com/app", "p", "p");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileOsMismatchError);
    }
  });

  test("win32 marker on a linux process can never reach the headless spawn", async () => {
    const runner = neverSpawnRunner();
    const d = new PlaywrightCliDriver({
      runner,
      profileOsMarker: markerStub("win32") as never,
      platformDetector: () => "linux",
    });

    try {
      await d.openHeadless("https://gemini.google.com/app", "p", "p");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileOsMismatchError);
    }
  });

  test("same-platform marker proceeds to the spawn (guard must not block normal flows)", async () => {
    const runner = neverSpawnRunner();
    (runner.run as ReturnType<typeof mock>).mockImplementation(
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );
    const d = new PlaywrightCliDriver({
      runner,
      profileOsMarker: markerStub("win32") as never,
      platformDetector: () => "win32",
    });

    await expect(d.openHeadless("https://gemini.google.com/app", "p", "p")).resolves.toBeUndefined();
  });
});
