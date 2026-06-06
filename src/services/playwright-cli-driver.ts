import { spawn, type ChildProcess } from "node:child_process";
import type { Cookie } from "../core/types.ts";

const CLI_BIN = "bunx";
const CLI_PACKAGE = "@playwright/cli";

export class PlaywrightCliError extends Error {
  constructor(command: string, exitCode: number, stderr: string) {
    super(`playwright-cli '${command}' exited with code ${exitCode}: ${stderr}`);
    this.name = "PlaywrightCliError";
  }
}

export class PlaywrightCliDriver {
  private readonly logger?: Console;
  private browserProcess: ChildProcess | null = null;

  constructor(logger?: Console) {
    this.logger = logger;
  }

  async runCli(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(CLI_BIN, [CLI_PACKAGE, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        env: { ...process.env },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on("error", (err: Error) => {
        reject(new PlaywrightCliError(args.join(" "), -1, err.message));
      });

      proc.on("close", (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

        if (code !== 0) {
          reject(new PlaywrightCliError(args.join(" "), code ?? -1, stderr));
          return;
        }

        resolve(stdout);
      });
    });
  }

  withSession(session: string, args: string[]): string[] {
    return [`-s=${session}`, ...args];
  }

  async openHeaded(url: string, profile: string, session?: string): Promise<void> {
    const args: string[] = [];
    if (session) {
      args.push(`-s=${session}`);
    }
    args.push(
      "open",
      url,
      "--browser=chromium",
      "--headed",
      "--persistent",
      `--profile=${profile}`,
    );

    const proc = spawn(CLI_BIN, [CLI_PACKAGE, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env },
      detached: false,
    });

    this.browserProcess = proc;

    proc.on("error", (err: Error) => {
      this.logger?.warn(`Browser process error: ${err.message}`);
    });

    proc.on("close", () => {
      if (this.browserProcess === proc) {
        this.browserProcess = null;
      }
    });
  }

  async evalJs(session: string, expression: string): Promise<string> {
    const args = this.withSession(session, ["eval", expression, "--json"]);
    return this.runCli(args);
  }

  async cookieList(session: string): Promise<Cookie[]> {
    const args = this.withSession(session, ["cookie-list", "--json"]);
    const output = await this.runCli(args);
    return this.parseCookieListOutput(output);
  }

  async stateSave(session: string, path: string): Promise<void> {
    const args = this.withSession(session, ["state-save", path]);
    await this.runCli(args);
  }

  async stateLoad(session: string, path: string): Promise<void> {
    const args = this.withSession(session, ["state-load", path]);
    await this.runCli(args);
  }

  async closeSession(session: string): Promise<void> {
    const args = this.withSession(session, ["close"]);
    await this.runCli(args);
  }

  async closeAll(): Promise<void> {
    await this.runCli(["close-all"]);
  }

  private parseCookieListOutput(raw: string): Cookie[] {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.logger?.warn("cookie-list returned non-array JSON");
        return [];
      }
      return parsed.map((c: Record<string, unknown>) => ({
        name: String(c.name ?? ""),
        value: String(c.value ?? ""),
        domain: String(c.domain ?? ""),
        path: String(c.path ?? "/"),
        expires: typeof c.expires === "number" ? c.expires : -1,
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: (["Strict", "Lax", "None"].includes(String(c.sameSite))
          ? String(c.sameSite)
          : "None") as Cookie["sameSite"],
      }));
    } catch {
      this.logger?.warn(`Failed to parse cookie-list output as JSON: ${raw}`);
      return [];
    }
  }
}
