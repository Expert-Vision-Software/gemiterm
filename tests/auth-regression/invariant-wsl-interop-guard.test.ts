// Invariant: WSL Windows-interop playwright-cli guard (issue #27, 2026-09-14).
// A `playwright-cli` resolved under /mnt/* from WSL is the WINDOWS install;
// its state-save re-resolves POSIX temp paths against the current drive
// (/tmp/x -> C:\tmp\x), so the state round-trip lands outside the WSL
// filesystem and every rotation/capture fails with readJsonFile ENOENT.
// The probe MUST reject such binaries (falling through to bunx) and, when
// nothing native remains, MUST fail with an actionable interop message —
// never the bare "readJsonFile failed" string.
import { describe, test, expect } from "bun:test";
import {
  PlaywrightCliDriver,
  PlaywrightCliUnavailableError,
  type PlaywrightRunner,
} from "../../src/services/playwright-cli-driver.ts";

function mockRunner(strategy: "direct" | "bunx"): PlaywrightRunner {
  return {
    strategy,
    run: async () => ({ exitCode: 0, stdout: "1.0.0", stderr: "" }),
    spawnDetached: () => {},
  };
}

const INTEROP = "/mnt/c/Users/diego/AppData/Roaming/npm/playwright-cli";

describe("auth-regression: WSL interop playwright-cli guard", () => {
  test("probe rejects /mnt/*-resolved direct binary and falls through to bunx", async () => {
    const direct = mockRunner("direct");
    let directProbed = 0;
    direct.run = async () => {
      directProbed++;
      return { exitCode: 0, stdout: "1.0.0", stderr: "" };
    };
    const bunx = mockRunner("bunx");
    const d = new PlaywrightCliDriver({
      probeRunners: [direct, bunx],
      wslDetector: async () => true,
      binaryPathResolver: async () => [INTEROP],
    });

    await d.runCli(["--version"]);

    expect(d.strategy).toBe("bunx");
    expect(directProbed).toBe(0); // the Windows binary must never be invoked
  });

  test("with no distro-native binary and failing bunx, error names the interop problem", async () => {
    const direct = mockRunner("direct");
    const bunx = mockRunner("bunx");
    bunx.run = async () => ({ exitCode: 1, stdout: "", stderr: "" });
    const d = new PlaywrightCliDriver({
      probeRunners: [direct, bunx],
      wslDetector: async () => true,
      binaryPathResolver: async () => [INTEROP],
    });

    try {
      await d.runCli(["--version"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PlaywrightCliUnavailableError);
      expect((err as Error).message).toContain("/mnt/c");
      expect((err as Error).message).toContain("distro-native");
    }
  });

  test("distro-native playwright-cli is accepted under WSL", async () => {
    const direct = mockRunner("direct");
    const bunx = mockRunner("bunx");
    const d = new PlaywrightCliDriver({
      probeRunners: [direct, bunx],
      wslDetector: async () => true,
      binaryPathResolver: async () => ["/usr/local/bin/playwright-cli"],
    });

    await d.runCli(["--version"]);

    expect(d.strategy).toBe("direct");
  });

  test("guard never fires outside WSL", async () => {
    const direct = mockRunner("direct");
    const bunx = mockRunner("bunx");
    const d = new PlaywrightCliDriver({
      probeRunners: [direct, bunx],
      wslDetector: async () => false,
      binaryPathResolver: async () => [INTEROP],
    });

    await d.runCli(["--version"]);

    expect(d.strategy).toBe("direct");
  });
});
