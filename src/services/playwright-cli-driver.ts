import { getProfileDir } from "../infrastructure/path-utils.ts";
import type { Cookie } from "../core/types.ts";

const CLI_BIN_DIRECT = "playwright-cli";
const CLI_BIN_FALLBACK = "bunx";
const CLI_PACKAGE = "@playwright/cli";
const PROBE_TIMEOUT_MS = 5_000;
const BROWSER_CLOSED_MESSAGE = "not found";

export class PlaywrightCliError extends Error {
  constructor(command: string, exitCode: number, stderr: string) {
    super(`playwright-cli '${command}' exited with code ${exitCode}: ${stderr}`);
    this.name = "PlaywrightCliError";
  }
}

export interface PlaywrightRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type PlaywrightStrategy = "direct" | "bunx";

export interface PlaywrightRunner {
  readonly strategy: PlaywrightStrategy;
  run(args: string[]): Promise<PlaywrightRunnerResult>;
  spawnDetached(args: string[]): void;
}

class BunPlaywrightRunner implements PlaywrightRunner {
  readonly strategy: PlaywrightStrategy;
  private readonly bin: string[];

  constructor(strategy: PlaywrightStrategy) {
    this.strategy = strategy;
    this.bin = strategy === "direct" ? [CLI_BIN_DIRECT] : [CLI_BIN_FALLBACK, CLI_PACKAGE];
  }

  async run(args: string[]): Promise<PlaywrightRunnerResult> {
    const proc = Bun.spawn([...this.bin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      exitCode: exitCode ?? -1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }

  spawnDetached(args: string[]): void {
    const proc = Bun.spawn([...this.bin, ...args], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    proc.exited.catch(() => {});
  }
}

export interface PlaywrightCliDriverOptions {
  logger?: Console;
  runner?: PlaywrightRunner;
  profileDirResolver?: (profileName: string) => string;
}

export class PlaywrightCliDriver {
  private readonly logger?: Console;
  private runner: PlaywrightRunner;
  private readonly profileDirResolver: (profileName: string) => string;
  private probed = false;

  constructor(opts: PlaywrightCliDriverOptions = {}) {
    this.logger = opts.logger;
    this.profileDirResolver = opts.profileDirResolver ?? ((name) => getProfileDir(name));
    this.runner = opts.runner ?? new BunPlaywrightRunner("direct");
  }

  async isAvailable(): Promise<boolean> {
    if (!this.probed) {
      const ok = await this.probe();
      this.probed = true;
      return ok;
    }
    return true;
  }

  get strategy(): PlaywrightStrategy {
    return this.runner.strategy;
  }

  async runCli(args: string[]): Promise<string> {
    const result = await this.runner.run(args);
    if (result.exitCode !== 0) {
      throw new PlaywrightCliError(args.join(" "), result.exitCode, result.stderr);
    }
    return result.stdout;
  }

  withSession(session: string, args: string[]): string[] {
    return [`-s=${session}`, ...args];
  }

  buildOpenHeadedArgs(url: string, profile: string, session?: string): string[] {
    const args: string[] = [];
    if (session) {
      args.push(`-s=${session}`);
    }
    args.push(
      "open",
      "--browser=chromium",
      "--headed",
      "--persistent",
      `--profile=${this.profileDirResolver(profile)}`,
      url,
    );
    return args;
  }

  async openHeaded(url: string, profile: string, session?: string): Promise<void> {
    const args = this.buildOpenHeadedArgs(url, profile, session);
    await this.runCli(args);
  }

  async evalJs(session: string, expression: string): Promise<string> {
    return this.runCli(this.withSession(session, ["eval", expression, "--raw"]));
  }

  async cookieList(session: string): Promise<Cookie[]> {
    const raw = await this.runCli(this.withSession(session, ["cookie-list", "--json"]));
    return this.parseCookieListOutput(raw);
  }

  async stateSave(session: string, path: string): Promise<void> {
    await this.runCli(this.withSession(session, ["state-save", path]));
  }

  async stateLoad(session: string, path: string): Promise<void> {
    await this.runCli(this.withSession(session, ["state-load", path]));
  }

  async closeSession(session: string): Promise<void> {
    try {
      await this.runCli(this.withSession(session, ["close"]));
    } catch (err) {
      if (err instanceof PlaywrightCliError && err.message.toLowerCase().includes(BROWSER_CLOSED_MESSAGE)) {
        return;
      }
      throw err;
    }
  }

  async closeAll(): Promise<void> {
    await this.runCli(["close-all"]);
  }

  private async probe(): Promise<boolean> {
    const direct = new BunPlaywrightRunner("direct");
    if (await this.tryVersion(direct)) {
      this.runner = direct;
      return true;
    }
    const bunx = new BunPlaywrightRunner("bunx");
    if (await this.tryVersion(bunx)) {
      this.runner = bunx;
      return true;
    }
    this.logger?.warn("Neither 'playwright-cli' nor 'bunx @playwright/cli' is available on this system.");
    return false;
  }

  private async tryVersion(r: BunPlaywrightRunner): Promise<boolean> {
    try {
      const result = await Promise.race([
        r.run(["--version"]),
        new Promise<{ exitCode: number }>((_, reject) =>
          setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS),
        ),
      ]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private parseCookieListOutput(raw: string): Cookie[] {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((c: Record<string, unknown>) => this.cookieFromObject(c));
      }
      if (parsed && typeof parsed === "object" && typeof (parsed as { result?: unknown }).result === "string") {
        const inner = (parsed as { result: string }).result;
        if (inner === "No cookies found") return [];
        try {
          const innerParsed = JSON.parse(inner);
          if (Array.isArray(innerParsed)) {
            return innerParsed.map((c: Record<string, unknown>) => this.cookieFromObject(c));
          }
        } catch {
          // inner was not a JSON array — fall through to the plain-text parser
        }
        return this.parseCookieListText(inner);
      }
    } catch {
      // not JSON; treat raw as plain text
    }
    return this.parseCookieListText(raw);
  }

  private parseCookieListText(text: string): Cookie[] {
    const cookies: Cookie[] = [];
    const re = /^([^=]+)=(.+) \(domain: ([^,]+), path: (.+)\)$/;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "No cookies found") continue;
      const match = trimmed.match(re);
      if (!match) continue;
      cookies.push(this.cookieFromObject({
        name: match[1],
        value: match[2],
        domain: match[3],
        path: match[4],
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "None",
      }));
    }
    return cookies;
  }

  private cookieFromObject(c: Record<string, unknown>): Cookie {
    return {
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
    };
  }
}
