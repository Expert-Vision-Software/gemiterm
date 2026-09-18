import { getProfileDir, getTempFilePath, isWSL, isWindowsInteropPath, joinPath } from "../infrastructure/path-utils.ts";
import { IOError, readJsonFile, readTextFile, removeDir, writeTextFile } from "../infrastructure/io.ts";
import { ProfileOsMismatchError } from "../core/errors.ts";
import type { Cookie } from "../core/types.ts";

const CLI_BIN_DIRECT = "playwright-cli";
const CLI_BIN_FALLBACK = "bunx";
const CLI_PACKAGE = "@playwright/cli";
const PROBE_TIMEOUT_MS = 5_000;
const BROWSER_CLOSED_MARKERS = ["is not open", "not found"] as const;

export function isBrowserClosedError(err: unknown): boolean {
  if (!(err instanceof PlaywrightCliError)) {
    return false;
  }
  const haystack = err.message.toLowerCase();
  return BROWSER_CLOSED_MARKERS.some((marker) => haystack.includes(marker));
}

export class PlaywrightCliError extends Error {
  constructor(command: string, exitCode: number, stderr: string) {
    super(`playwright-cli '${command}' exited with code ${exitCode}: ${stderr}`);
    this.name = "PlaywrightCliError";
  }
}

const WSL_INTEROP_HINT =
  "Under WSL this usually means the Windows playwright-cli was resolved via " +
  "/mnt/* interop; install a distro-native one with 'npm i -g @playwright/cli' " +
  "inside the WSL distro (issue #27).";

const MISSING_DEPS_MARKER = "missing system dependencies required to run browser";
const MISSING_DEPS_REMEDIATION =
  "Browser system dependencies are missing. Run one of:\n" +
  "  sudo npx playwright install-deps chrome-for-testing\n" +
  "  npx @playwright/cli install-browser --with-deps\n" +
  "then retry the command (issue #30).";

// Issue #30: the playwright-cli daemon leaks a multi-page stack trace when the
// browser binary cannot launch for lack of system libraries; classify it so
// callers print the remediation, not the trace.
export function isMissingDependenciesStderr(stderr: string): boolean {
  return stderr.toLowerCase().includes(MISSING_DEPS_MARKER);
}

export class MissingBrowserDependenciesError extends Error {
  constructor() {
    super(MISSING_DEPS_REMEDIATION);
    this.name = "MissingBrowserDependenciesError";
  }
}

export class PlaywrightCliUnavailableError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Playwright CLI not found. Install it with 'npm i -g @playwright/cli' " +
        "(or 'bun add -g @playwright/cli'), or ensure 'bunx' is available to run '@playwright/cli'.",
    );
    this.name = "PlaywrightCliUnavailableError";
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

// Cross-OS profile guard (docs/auth-cookie-lifecycle.md §4.3 device
// continuity): the profile's Chromium user-data dir doubles as device identity
// AND browser-side session storage, so it is bound to the OS browser that
// created it. Field evidence 2026-09-15/16: the other OS's Chromium wiped the
// browser-side auth cookies (only anonymous cookies remained), killing every
// later rotation. `browser-os.marker` records the owning OS inside the
// user-data dir (no Chromium-managed file uses that name).
export const PROFILE_OS_MARKER_FILE = "browser-os.marker";

const MARKER_PLATFORMS = ["win32", "linux", "darwin"] as const;

export interface ProfileOsMarker {
  /** The platform recorded in the profile's marker, or null when absent/unreadable/corrupt (claimable). */
  read(profileDir: string): Promise<string | null>;
  /** Records the owning platform in the profile. May reject; the driver never lets that block auth. */
  claim(profileDir: string, platform: string): Promise<void>;
}

export class FsProfileOsMarker implements ProfileOsMarker {
  async read(profileDir: string): Promise<string | null> {
    let content: string;
    try {
      content = await readTextFile(joinPath(profileDir, PROFILE_OS_MARKER_FILE));
    } catch {
      return null;
    }
    const platform = content.trim();
    return (MARKER_PLATFORMS as readonly string[]).includes(platform) ? platform : null;
  }

  async claim(profileDir: string, platform: string): Promise<void> {
    await writeTextFile(joinPath(profileDir, PROFILE_OS_MARKER_FILE), platform);
  }
}

// windowsHide: Bun.spawn defaults it to false at the JS layer, so every
// short-lived playwright-cli subprocess would flash its own console window
// on Windows (no-op elsewhere).
export class BunPlaywrightRunner implements PlaywrightRunner {
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
      windowsHide: true,
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
      windowsHide: true,
    });
    proc.exited.catch(() => {});
  }
}

export interface PlaywrightCliDriverOptions {
  logger?: Console;
  runner?: PlaywrightRunner;
  profileDirResolver?: (profileName: string) => string;
  probeRunners?: PlaywrightRunner[];
  wslDetector?: () => Promise<boolean>;
  binaryPathResolver?: (bin: string) => Promise<string[]>;
  profileOsMarker?: ProfileOsMarker;
  platformDetector?: () => string;
}

// Default `binaryPathResolver`: `which -a <bin>`, one resolved path per line.
// Empty on failure — the probe then falls back to the plain version check.
async function whichAll(bin: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(["which", "-a", bin], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      windowsHide: true,
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return [];
    return stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

export class PlaywrightCliDriver {
  private readonly logger?: Console;
  private runner: PlaywrightRunner;
  private readonly profileDirResolver: (profileName: string) => string;
  private readonly probeRunners: PlaywrightRunner[];
  private readonly wslDetector: () => Promise<boolean>;
  private readonly binaryPathResolver: (bin: string) => Promise<string[]>;
  private readonly profileOsMarker: ProfileOsMarker;
  private readonly platformDetector: () => string;
  private probed = false;
  private unavailableMessage?: string;

  constructor(opts: PlaywrightCliDriverOptions = {}) {
    this.logger = opts.logger;
    this.profileDirResolver = opts.profileDirResolver ?? ((name) => getProfileDir(name));
    this.runner = opts.runner ?? new BunPlaywrightRunner("direct");
    this.probeRunners = opts.probeRunners ?? [
      new BunPlaywrightRunner("direct"),
      new BunPlaywrightRunner("bunx"),
    ];
    this.wslDetector = opts.wslDetector ?? isWSL;
    this.binaryPathResolver = opts.binaryPathResolver ?? whichAll;
    this.profileOsMarker = opts.profileOsMarker ?? new FsProfileOsMarker();
    this.platformDetector = opts.platformDetector ?? (() => process.platform);
    this.probed = opts.runner !== undefined;
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
    if (!this.probed) {
      const ok = await this.isAvailable();
      if (!ok) {
        throw new PlaywrightCliUnavailableError(this.unavailableMessage);
      }
    }
    const result = await this.runner.run(args);
    if (result.exitCode !== 0) {
      if (isMissingDependenciesStderr(result.stderr)) {
        throw new MissingBrowserDependenciesError();
      }
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

  // Cross-OS profile guard: the only two browser-opening methods (capture =
  // openHeaded, rotation = openHeadless) must refuse a profile owned by a
  // different OS BEFORE any spawn. Absent/unreadable/corrupt marker => claim
  // the current platform; a claim failure must never block auth (same axiom as
  // the refresh-runner lock).
  private async enforceProfileOsOwnership(profile: string): Promise<void> {
    const profileDir = this.profileDirResolver(profile);
    const currentPlatform = this.platformDetector();
    let recorded: string | null;
    try {
      recorded = await this.profileOsMarker.read(profileDir);
    } catch {
      recorded = null;
    }
    if (recorded === null) {
      try {
        await this.profileOsMarker.claim(profileDir, currentPlatform);
      } catch (err) {
        this.logger?.warn(
          `Could not write ${PROFILE_OS_MARKER_FILE} for profile '${profile}' ` +
            `(${err instanceof Error ? err.message : String(err)}); proceeding without an OS marker.`,
        );
      }
      return;
    }
    if (recorded !== currentPlatform) {
      throw new ProfileOsMismatchError(profile, recorded, currentPlatform);
    }
  }

  async openHeaded(url: string, profile: string, session?: string): Promise<void> {
    await this.enforceProfileOsOwnership(profile);
    const args = this.buildOpenHeadedArgs(url, profile, session);
    await this.runCli(args);
  }

  buildOpenHeadlessArgs(url: string, profile: string, session?: string): string[] {
    const args: string[] = [];
    if (session) {
      args.push(`-s=${session}`);
    }
    args.push(
      "open",
      "--browser=chromium",
      "--persistent",
      `--profile=${this.profileDirResolver(profile)}`,
      url,
    );
    return args;
  }

  async openHeadless(url: string, profile: string, session?: string): Promise<void> {
    await this.enforceProfileOsOwnership(profile);
    const args = this.buildOpenHeadlessArgs(url, profile, session);
    await this.runCli(args);
  }

  async evalJs(session: string, expression: string): Promise<string> {
    return this.runCli(this.withSession(session, ["eval", expression, "--raw"]));
  }

  async cookieList(session: string): Promise<Cookie[]> {
    const raw = await this.runCli(this.withSession(session, ["cookie-list", "--json"]));
    return this.parseCookieListOutput(raw);
  }

  async cookieListFromState(session: string): Promise<Cookie[]> {
    const tempPath = getTempFilePath("gemiterm-state", ".json");
    try {
      await this.stateSave(session, tempPath);
      let state: { cookies?: unknown[] };
      try {
        state = await readJsonFile<{ cookies?: unknown[] }>(tempPath);
      } catch (err) {
        throw this.classifyStateReadError(tempPath, err);
      }
      const cookies = Array.isArray(state.cookies) ? state.cookies : [];
      return cookies
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
        .map((c) => this.cookieFromObject(c));
    } finally {
      await removeDir(tempPath);
    }
  }

  // Distinguish "state-save claimed success but the file is not there" (the
  // WSL interop signature — the Windows binary wrote it to the Windows
  // filesystem, issue #27) from "the file exists but is not valid JSON".
  private classifyStateReadError(path: string, err: unknown): Error {
    if (!(err instanceof IOError)) {
      return err instanceof Error ? err : new Error(String(err));
    }
    const raw = err.cause;
    const code = (raw as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return new IOError(
        `playwright-cli reported success writing '${path}' but the file was not found. ` +
          WSL_INTEROP_HINT,
        raw instanceof Error ? raw : err,
      );
    }
    return new IOError(
      `readJsonFile: state file '${path}' is not valid JSON; the playwright-cli ` +
        `write may have failed silently. ${WSL_INTEROP_HINT}`,
      err,
    );
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
      if (isBrowserClosedError(err)) {
        return;
      }
      throw err;
    }
  }

  async closeAll(): Promise<void> {
    await this.runCli(["close-all"]);
  }

  private async probe(): Promise<boolean> {
    for (const candidate of this.probeRunners) {
      if (candidate.strategy === "direct" && (await this.isWindowsInteropBinary())) {
        continue;
      }
      if (await this.tryVersion(candidate)) {
        this.runner = candidate;
        return true;
      }
    }
    this.logger?.warn("Neither 'playwright-cli' nor 'bunx @playwright/cli' is available on this system.");
    return false;
  }

  // WSL guard (issue #27): a `playwright-cli` resolved under /mnt/* is the
  // WINDOWS install reached through interop. It accepts POSIX paths but
  // re-resolves them against the current drive (`/tmp/x` -> `C:\tmp\x`), so
  // state-save round-trips land outside the WSL filesystem. Require a
  // distro-native binary and fall through to the bunx strategy instead.
  private async isWindowsInteropBinary(): Promise<boolean> {
    if (!(await this.wslDetector())) {
      return false;
    }
    const paths = await this.binaryPathResolver(CLI_BIN_DIRECT);
    if (paths.length === 0 || !paths.every(isWindowsInteropPath)) {
      return false;
    }
    this.unavailableMessage =
      "playwright-cli resolved only through Windows interop (" +
      paths.join(", ") +
      "). " + WSL_INTEROP_HINT;
    this.logger?.warn(this.unavailableMessage);
    return true;
  }

  private async tryVersion(r: PlaywrightRunner): Promise<boolean> {
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
