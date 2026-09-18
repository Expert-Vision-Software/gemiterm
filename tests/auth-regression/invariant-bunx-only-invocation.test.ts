// Invariant: bunx-only playwright-cli invocation (issue #31, 2026-09-18).
// The driver MUST invoke the CLI exclusively as `bunx @playwright/cli`. A
// globally installed `playwright-cli` pins its own playwright-core browser
// revision, which skewed from the revision `install-browser` (already bunx-
// based) downloaded — producing "Browser chrome-for-testing is not installed"
// for a revision nobody asked for. One invocation path = one revision, no
// user-managed versioning. The probe is a single `bunx @playwright/cli
// --version` check; there is no direct-binary candidate and no WSL interop
// guard to fall through (bunx resolves distro-natively under WSL).
import { describe, test, expect, mock, spyOn } from "bun:test";
import {
  BunPlaywrightRunner,
  PlaywrightCliDriver,
  PlaywrightCliUnavailableError,
} from "../../src/services/playwright-cli-driver.ts";

function fakeSpawnSpy(stdout = "1.0.0"): ReturnType<typeof spyOn> {
  return spyOn(Bun, "spawn").mockImplementation((() => ({
    stdout: new Response(stdout),
    stderr: new Response(""),
    exited: Promise.resolve(0),
  })) as never);
}

describe("auth-regression: bunx-only playwright-cli invocation", () => {
  test("runner spawns bunx @playwright/cli, never a direct playwright-cli binary", async () => {
    const spawnSpy = fakeSpawnSpy();
    try {
      const runner = new BunPlaywrightRunner();
      await runner.run(["--version"]);

      const argv = spawnSpy.mock.calls[0][0] as string[];
      expect(argv.slice(0, 2)).toEqual(["bunx", "@playwright/cli"]);
      expect(argv).not.toContain("playwright-cli");
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("detached spawn (rotation path) uses the same bunx argv", () => {
    const spawnSpy = fakeSpawnSpy();
    try {
      const runner = new BunPlaywrightRunner();
      runner.spawnDetached(["open", "--browser=chromium"]);

      const argv = spawnSpy.mock.calls[0][0] as string[];
      expect(argv.slice(0, 2)).toEqual(["bunx", "@playwright/cli"]);
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("probe fails closed with PlaywrightCliUnavailableError when bunx is broken", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => ({
      stdout: new Response(""),
      stderr: new Response("bunx: command not found"),
      exited: Promise.resolve(1),
    })) as never);
    try {
      const d = new PlaywrightCliDriver();
      await expect(d.runCli(["--version"])).rejects.toBeInstanceOf(
        PlaywrightCliUnavailableError,
      );
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
