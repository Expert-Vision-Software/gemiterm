// Invariant: missing browser system-dependencies guidance (issue #30,
// 2026-09-17). On Linux/WSL, `gemiterm auth` failed with the raw playwright-cli
// daemon stack trace when the installed Chrome-for-Testing binary could not
// launch because system libraries are missing. The driver MUST classify that
// stderr signature and surface a single actionable message naming the exact
// remediation commands — never the daemon stack trace.
import { describe, test, expect } from "bun:test";
import {
  PlaywrightCliDriver,
  MissingBrowserDependenciesError,
  type PlaywrightRunner,
} from "../../src/services/playwright-cli-driver.ts";

const DAEMON_STACK_STDERR = [
  "Error: Daemon pid=1240: Daemon process exited with code 1",
  "Error: Missing system dependencies required to run browser chrome-for-testing. " +
    "Install them with: sudo npx playwright install-deps chrome-for-testing",
  "    at createPersistentBrowser (…/playwright-core/lib/coreBundle.js:73406:13)",
  "    at async createBrowserWithInfo (…/playwright-core/lib/coreBundle.js:73311:11)",
].join("\n");

function failingRunner(stderr: string): PlaywrightRunner {
  return {
    strategy: "direct",
    run: async () => ({ exitCode: 1, stdout: "", stderr }),
    spawnDetached: () => {},
  };
}

function driverWith(runner: PlaywrightRunner): PlaywrightCliDriver {
  return new PlaywrightCliDriver({ runner, profileDirResolver: () => "/tmp/profiles/default" });
}

describe("auth-regression: missing browser system-dependencies guidance", () => {
  test("browser open failure with the missing-deps stderr signature is classified", async () => {
    const d = driverWith(failingRunner(DAEMON_STACK_STDERR));

    try {
      await d.openHeaded("https://gemini.google.com/app", "default");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MissingBrowserDependenciesError);
    }
  });

  test("classified error message contains the exact install-deps remediation", async () => {
    const d = driverWith(failingRunner(DAEMON_STACK_STDERR));

    const err = await d.openHeaded("https://gemini.google.com/app", "default").catch((e) => e);

    expect(err).toBeInstanceOf(MissingBrowserDependenciesError);
    expect(err.message).toContain("sudo npx playwright install-deps chrome-for-testing");
  });

  test("classified error message mentions the --with-deps browser reinstall alternative", async () => {
    const d = driverWith(failingRunner(DAEMON_STACK_STDERR));

    const err = await d.openHeaded("https://gemini.google.com/app", "default").catch((e) => e);

    expect(err.message).toContain("npx @playwright/cli install-browser --with-deps");
  });

  test("classified error message never leaks the daemon stack trace", async () => {
    const d = driverWith(failingRunner(DAEMON_STACK_STDERR));

    const err = await d.openHeaded("https://gemini.google.com/app", "default").catch((e) => e);

    expect(err.message).not.toContain("at createPersistentBrowser");
    expect(err.message).not.toContain("Daemon process exited");
    expect(err.message).not.toContain("playwright-core");
  });

  test("classification applies to the headless rotation path too", async () => {
    const d = driverWith(failingRunner(DAEMON_STACK_STDERR));

    const err = await d.openHeadless("https://gemini.google.com/app", "default").catch((e) => e);

    expect(err).toBeInstanceOf(MissingBrowserDependenciesError);
  });

  test("unrelated launch failures keep the raw PlaywrightCliError", async () => {
    const d = driverWith(failingRunner("Error: Daemon pid=7: something else went wrong"));

    const err = await d.openHeaded("https://gemini.google.com/app", "default").catch((e) => e);

    expect(err).not.toBeInstanceOf(MissingBrowserDependenciesError);
    expect((err as Error).name).toBe("PlaywrightCliError");
  });
});
