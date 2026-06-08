import { existsFile, safeReadTextFile } from "../infrastructure/io.ts";
import { isWSL } from "../infrastructure/path-utils.ts";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PlaywrightCliError } from "./playwright-cli-driver.ts";
import { Logger } from "../infrastructure/logger.ts";

const BROWSER_NAMES = ["chromium"];

interface BrowserCheckResult {
  found: boolean;
  browserName: string;
  path?: string;
}

export class InstallBrowserError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "InstallBrowserError";
  }
}

interface WindowsKnownDirs {
  programFiles: string;
  localAppData: string;
}

function getWindowsKnownDirs(): WindowsKnownDirs {
  const programFiles = process.env["ProgramFiles(x86)"] ?? process.env["ProgramFiles"] ?? "C:\\Program Files";
  const localAppData = process.env["LOCALAPPDATA"] ?? join(process.env["USERPROFILE"] ?? "C:\\Users", "AppData", "Local");
  return { programFiles, localAppData };
}

export class InstallBrowserService {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("install-browser-service");
  }

  async install(): Promise<void> {
    this.logger.info("Checking for existing browser installations...");

    const existing = this.findSystemBrowser();
    if (existing.found) {
      this.logger.info(`Found existing browser: ${existing.browserName} at ${existing.path}`);
      console.log(`Using existing ${existing.browserName} installation.`);
      return;
    }

    console.log("No suitable browser found. Installing Chromium via Playwright...");
    this.logger.info("Running: bunx @playwright/cli install chromium");

    try {
      const output = await this.runInstall();
      this.logger.info(`Browser installation output: ${output}`);
      console.log("Chromium installed successfully.");
    } catch (error) {
      if (error instanceof PlaywrightCliError) {
        throw new InstallBrowserError(error.message, error);
      }
      throw new InstallBrowserError(
        `Failed to install Chromium: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  findSystemBrowser(): BrowserCheckResult {
    if (process.platform === "win32") {
      return this.findWindowsBrowser();
    }
    if (process.platform === "linux") {
      return this.findLinuxBrowser();
    }
    return { found: false, browserName: "none" };
  }

  private findWindowsBrowser(): BrowserCheckResult {
    const { programFiles, localAppData } = getWindowsKnownDirs();
    const candidates = [
      { name: "Microsoft Edge", paths: [
        join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]},
      { name: "Google Chrome", paths: [
        join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      ]},
    ];

    for (const candidate of candidates) {
      for (const path of candidate.paths) {
        if (existsFile(path)) {
          return { found: true, browserName: candidate.name, path };
        }
      }
    }

    return { found: false, browserName: "none" };
  }

  private findLinuxBrowser(): BrowserCheckResult {
    const candidates = [
      { name: "Google Chrome", path: "/usr/bin/google-chrome" },
      { name: "Google Chrome (Beta)", path: "/usr/bin/google-chrome-beta" },
      { name: "Chromium", path: "/usr/bin/chromium" },
      { name: "Chromium Browser", path: "/usr/bin/chromium-browser" },
      { name: "Microsoft Edge", path: "/usr/bin/microsoft-edge" },
    ];

    for (const candidate of candidates) {
      if (existsFile(candidate.path)) {
        return { found: true, browserName: candidate.name, path: candidate.path };
      }
    }

    if (isWSL()) {
      return this.findWslBrowser();
    }

    return { found: false, browserName: "none" };
  }

  private findWslBrowser(): BrowserCheckResult {
    const windowsRoot = this.getWslWindowsRoot();
    if (!windowsRoot) {
      return { found: false, browserName: "none" };
    }

    const edgePath = join(windowsRoot, "Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
    const chromePath = join(windowsRoot, "Program Files", "Google", "Chrome", "Application", "chrome.exe");

    if (existsFile(edgePath)) {
      return { found: true, browserName: "Microsoft Edge (Windows via WSL)", path: edgePath };
    }
    if (existsFile(chromePath)) {
      return { found: true, browserName: "Google Chrome (Windows via WSL)", path: chromePath };
    }

    return { found: false, browserName: "none" };
  }

  private getWslWindowsRoot(): string | null {
    const mountOutput = safeReadTextFile("/proc/mounts");
    if (!mountOutput) {
      return null;
    }
    const lines = mountOutput.split("\n");
    for (const line of lines) {
      if (line.includes("9p") && line.includes("drvfs")) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const mountPoint = parts[1];
          if (mountPoint.endsWith("/")) {
            return mountPoint.slice(0, -1);
          }
          return mountPoint;
        }
      }
    }
    return null;
  }

  private async runInstall(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn("bunx", ["@playwright/cli", "install", ...BROWSER_NAMES], {
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
          reject(new PlaywrightCliError("install chromium", code ?? -1, stderr));
          return;
        }

        resolve(stdout);
      });
    });
  }
}
