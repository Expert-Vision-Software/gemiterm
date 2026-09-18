import { spawn } from "node:child_process";
import {
  PlaywrightCliError,
  MissingBrowserDependenciesError,
  MISSING_DEPS_REMEDIATION,
  isMissingDependenciesStderr,
} from "./playwright-cli-driver.ts";
import { getTempFilePath } from "../infrastructure/path-utils.ts";
import { removeDir } from "../infrastructure/io.ts";
import { Logger } from "../infrastructure/logger.ts";
import { isRunningElevated, ElevationError } from "../infrastructure/elevation.ts";

const BROWSER_NAMES = ["chrome-for-testing"];

const LAUNCH_PROBE_TIMEOUT_MS = 60_000;
const LAUNCH_PROBE_SESSION = "gemiterm-deps-probe";

export class InstallBrowserError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "InstallBrowserError";
  }
}

export interface InstallBrowserResult {
  /** Set when the browser binary was installed but system deps are missing (Linux, issue #31). */
  depsWarning?: string;
}

export interface InstallBrowserServiceOptions {
  logger?: Logger;
  platformDetector?: () => string;
  /** Verifies the installed browser can actually launch; throws MissingBrowserDependenciesError when system deps are missing. */
  launchProbe?: () => Promise<void>;
  depsInstaller?: () => Promise<void>;
  rootDetector?: () => boolean;
}

export class InstallBrowserService {
  private readonly logger: Logger;
  private readonly platformDetector: () => string;
  private readonly launchProbe: () => Promise<void>;
  private readonly depsInstaller: () => Promise<void>;
  private readonly rootDetector: () => boolean;

  constructor(opts: InstallBrowserServiceOptions = {}) {
    this.logger = opts.logger ?? new Logger("install-browser-service");
    this.platformDetector = opts.platformDetector ?? (() => process.platform);
    this.launchProbe = opts.launchProbe ?? (() => this.probeLaunch());
    this.depsInstaller = opts.depsInstaller ?? (() => this.runDepsInstall());
    this.rootDetector = opts.rootDetector ?? isRunningAsRoot;
  }

  async install(): Promise<InstallBrowserResult> {
    if (isRunningElevated()) {
      throw new ElevationError();
    }
    this.logger.info("Installing Chrome for Testing via Playwright...");
    console.log("Installing Chrome for Testing via Playwright...");
    this.logger.info("Running: bunx @playwright/cli install-browser chrome-for-testing");

    try {
      const output = await this.runInstall();
      this.logger.info(`Browser installation output: ${output}`);
    } catch (error) {
      if (error instanceof PlaywrightCliError) {
        throw new InstallBrowserError(error.message, error);
      }
      throw new InstallBrowserError(
        `Failed to install Chrome for Testing: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }

    // Issue #31: on Linux the binary alone is not enough — shared system
    // libraries may be missing, which only surfaced later as an `auth`
    // failure. Verify the browser can actually launch before declaring
    // success; non-Linux behaviour is unchanged.
    if (this.platformDetector() !== "linux") {
      console.log("Chrome for Testing installed successfully.");
      return {};
    }

    try {
      await this.launchProbe();
    } catch (error) {
      if (!(error instanceof MissingBrowserDependenciesError)) {
        throw new InstallBrowserError(
          "Chrome for Testing was installed but the launch verification failed: " +
            (error instanceof Error ? error.message : String(error)),
          error instanceof Error ? error : undefined,
        );
      }
      return this.handleMissingDeps();
    }

    console.log("Chrome for Testing installed successfully.");
    return {};
  }

  // Issue #31: attempt the automatic `--with-deps` installation unless we are
  // running as root/sudo — the elevated-run guard. Playwright's dep installer
  // shells out to sudo, and running it as root corrupts file permissions the
  // same way the Windows elevated install does. When guarded out (or when the
  // attempt fails), warn with the exact issue #30 remediation instead of an
  // unqualified success message.
  private async handleMissingDeps(): Promise<InstallBrowserResult> {
    if (this.rootDetector()) {
      this.logger.info("Running as root/sudo; skipping automatic system-deps installation (elevated-run guard).");
      return {
        depsWarning:
          "Cannot install system dependencies automatically while running as root/sudo.\n" +
          MISSING_DEPS_REMEDIATION,
      };
    }

    try {
      console.log("System dependencies are missing; attempting installation (may prompt for your sudo password)...");
      await this.depsInstaller();
    } catch (error) {
      this.logger.warn(
        `Automatic system-deps installation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { depsWarning: MISSING_DEPS_REMEDIATION };
    }

    try {
      await this.launchProbe();
    } catch {
      return { depsWarning: MISSING_DEPS_REMEDIATION };
    }

    console.log("Chrome for Testing installed successfully.");
    return {};
  }

  // Launch verification probe: open a throwaway headless persistent-profile
  // session against about:blank (the same shape as the auth rotation path)
  // and classify the stderr with the issue #30 dep classifier.
  private probeLaunch(): Promise<void> {
    const profileDir = getTempFilePath("gemiterm-deps-probe", "");
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "bunx",
        [
          "@playwright/cli",
          `-s=${LAUNCH_PROBE_SESSION}`,
          "open",
          "--browser=chromium",
          "--persistent",
          `--profile=${profileDir}`,
          "about:blank",
        ],
        { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", env: { ...process.env } },
      );

      const stderrChunks: Buffer[] = [];
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`launch verification timed out after ${LAUNCH_PROBE_TIMEOUT_MS}ms`));
      }, LAUNCH_PROBE_TIMEOUT_MS);

      proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        void removeDir(profileDir).catch(() => {});
        if (code === 0) {
          resolve();
          return;
        }
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");
        if (isMissingDependenciesStderr(stderr)) {
          reject(new MissingBrowserDependenciesError(stderr));
          return;
        }
        reject(new Error(`launch verification exited with code ${code ?? -1}: ${stderr.trim()}`));
      });
    });
  }

  private runDepsInstall(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // stdio inherit so the sudo password prompt reaches the user's terminal.
      const proc = spawn(
        "bunx",
        ["@playwright/cli", "install-browser", "--with-deps", ...BROWSER_NAMES],
        { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env } },
      );
      proc.on("error", (err: Error) => reject(err));
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`install-browser --with-deps exited with code ${code ?? -1}`));
          return;
        }
        resolve();
      });
    });
  }

  private async runInstall(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn("bunx", ["@playwright/cli", "install-browser", ...BROWSER_NAMES], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        env: { ...process.env },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        const text = chunk.toString("utf-8");
        this.logger.debug(text.trimEnd());
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        const text = chunk.toString("utf-8");
        this.logger.debug(text.trimEnd());
      });

      proc.on("error", (err: Error) => {
        reject(new InstallBrowserError(`Failed to spawn install process: ${err.message}`, err));
      });

      proc.on("close", (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

        if (code !== 0) {
          reject(new PlaywrightCliError("install-browser chrome-for-testing", code ?? -1, stderr));
          return;
        }

        resolve(stdout);
      });
    });
  }
}

// Elevated-run guard (issue #31): root/sudo must not run the automatic deps
// installation. Windows elevation is handled separately by isRunningElevated.
function isRunningAsRoot(): boolean {
  try {
    return typeof process.getuid === "function" && process.getuid() === 0;
  } catch {
    return false;
  }
}
