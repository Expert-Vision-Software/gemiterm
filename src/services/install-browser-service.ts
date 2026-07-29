import { spawn } from "node:child_process";
import { PlaywrightCliError } from "./playwright-cli-driver.ts";
import { Logger } from "../infrastructure/logger.ts";
import { isRunningElevated, ElevationError } from "../infrastructure/elevation.ts";

const BROWSER_NAMES = ["chrome-for-testing"];

export class InstallBrowserError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "InstallBrowserError";
  }
}

export class InstallBrowserService {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("install-browser-service");
  }

  async install(): Promise<void> {
    if (isRunningElevated()) {
      throw new ElevationError();
    }
    this.logger.info("Installing Chrome for Testing via Playwright...");
    console.log("Installing Chrome for Testing via Playwright...");
    this.logger.info("Running: bunx @playwright/cli install-browser chrome-for-testing");

    try {
      const output = await this.runInstall();
      this.logger.info(`Browser installation output: ${output}`);
      console.log("Chrome for Testing installed successfully.");
    } catch (error) {
      if (error instanceof PlaywrightCliError) {
        throw new InstallBrowserError(error.message, error);
      }
      throw new InstallBrowserError(
        `Failed to install Chrome for Testing: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
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
