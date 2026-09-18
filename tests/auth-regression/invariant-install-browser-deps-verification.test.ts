// Invariant: install-browser verifies system dependencies on Linux before
// declaring success (issue #31, 2026-09-17). A downloaded Chrome-for-Testing
// binary can still be unlaunchable when shared system libraries are missing;
// `gemiterm install-browser` must not print an unqualified success message in
// that case. The warning MUST reuse the canonical issue #30 remediation
// exported from the driver (MISSING_DEPS_REMEDIATION) so both surfaces stay
// in lockstep, and the automatic `--with-deps` install MUST respect the
// elevated-run guard (never attempted as root/sudo).
import { describe, test, expect } from "bun:test";
import {
  InstallBrowserService,
  type InstallBrowserServiceOptions,
} from "../../src/services/install-browser-service.ts";
import {
  MissingBrowserDependenciesError,
  MISSING_DEPS_REMEDIATION,
} from "../../src/services/playwright-cli-driver.ts";

function makeService(overrides: Partial<InstallBrowserServiceOptions> = {}): InstallBrowserService {
  return new InstallBrowserService({
    platformDetector: () => "linux",
    launchProbe: async () => {},
    depsInstaller: async () => {},
    rootDetector: () => false,
    ...overrides,
  });
}

function failingInstall(service: InstallBrowserService): Promise<ReturnType<InstallBrowserService["install"]>> {
  return service.install();
}

describe("auth-regression: install-browser deps verification (issue #31)", () => {
  test("MISSING_DEPS_REMEDIATION stays exported from the driver for the install-browser warning", () => {
    // The install-browser warning path renders this constant verbatim; if the
    // driver stops exporting (or rewords) it, the two surfaces drift apart.
    expect(MISSING_DEPS_REMEDIATION).toContain("sudo npx playwright install-deps chrome-for-testing");
    expect(MISSING_DEPS_REMEDIATION).toContain("npx @playwright/cli install-browser --with-deps");
  });

  test("missing deps on Linux yields the canonical remediation, never an unqualified success", async () => {
    const service = makeService({
      launchProbe: async () => {
        throw new MissingBrowserDependenciesError();
      },
      depsInstaller: async () => {
        throw new Error("no tty");
      },
    });

    const result = await failingInstall(service);

    expect(result.depsWarning).toBe(MISSING_DEPS_REMEDIATION);
  });

  test("automatic deps installation is never attempted as root/sudo (elevated-run guard)", async () => {
    let installerCalls = 0;
    const service = makeService({
      launchProbe: async () => {
        throw new MissingBrowserDependenciesError();
      },
      depsInstaller: async () => {
        installerCalls++;
      },
      rootDetector: () => true,
    });

    const result = await failingInstall(service);

    expect(installerCalls).toBe(0);
    expect(result.depsWarning).toContain("sudo npx playwright install-deps chrome-for-testing");
  });

  test("non-Linux platforms are never probed (behaviour unchanged)", async () => {
    let probeCalls = 0;
    const service = makeService({
      platformDetector: () => "win32",
      launchProbe: async () => {
        probeCalls++;
      },
    });

    const result = await failingInstall(service);

    expect(result).toEqual({});
    expect(probeCalls).toBe(0);
  });
});
