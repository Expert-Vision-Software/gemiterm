import chalk from "chalk";
import { CookieStorage, ProfileManager } from "../../infrastructure/storage.ts";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { getConfigDir, ensureConfigDir, listProfiles, getDefaultProfileName } from "../../infrastructure/config.ts";
import { getProfileDir } from "../../infrastructure/path-utils.ts";
import { formatProfileTable, formatDuration } from "../../infrastructure/formatters.ts";
import { QUERY_TYPES } from "../../core/query-handlers.ts";
import type { ProbeProfileQueryResult } from "../../core/query-handlers.ts";

export class StatusCommand implements CliCommand {
  readonly name = "status";
  readonly description = "Show configuration and profile status";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("status-command");
    logger.debug("Executing status command", args);

    if (args.includes("--help") || args.includes("-h")) {
      this.showUsage();
      return;
    }

    const verbose = args.includes("--verbose") || args.includes("-v");

    ensureConfigDir();

    const configDir = getConfigDir();
    logger.debug("Config directory:", configDir);
    console.log(chalk.bold("Configuration"));
    console.log(`  Directory: ${chalk.cyan(configDir)}`);
    console.log("");

    const profileNames = listProfiles();
    logger.debug("Profile scan found:", profileNames);
    if (profileNames.length === 0) {
      console.log(chalk.dim("No profiles found. Run 'gemiterm login' to create one."));
      process.exit(2);
    }

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    const statuses = profileNames.map((name) => {
      const status = profileManager.getStatus(name);
      return { ...status, isDefault: name === getDefaultProfileName() };
    });

    const probes = await Promise.all(
      profileNames.map((name) =>
        context.mediator
          .send<ProbeProfileQueryResult>({
            type: QUERY_TYPES.PROBE_PROFILE,
            payload: { profileName: name },
          })
          .catch((err): ProbeProfileQueryResult => ({
            result: "dead",
            chatsCount: 0,
            modelsCount: 0,
            error: err instanceof Error ? err.message : String(err),
          })),
      ),
    );

    const probeByName = new Map(profileNames.map((name, i) => [name, probes[i]!]));
    const enriched = statuses.map((s) => ({ ...s, probe: probeByName.get(s.name) }));
    console.log(chalk.bold("Profiles"));
    console.log(formatProfileTable(enriched));

    if (verbose) {
      console.log("");
      this.printCookieDetails(profileNames, cookieStorage);
      console.log("");
      this.printStoragePaths(profileNames);
    }

    const defaultName = getDefaultProfileName();
    const active = statuses.filter((s) => s.isActive);
    if (active.length > 0) {
      logger.info(`${active.length} of ${statuses.length} profile(s) active`);
    } else {
      logger.info("No profiles have valid sessions. Run 'gemiterm login' to authenticate.");
    }
  }

  private printCookieDetails(profileNames: readonly string[], cookieStorage: CookieStorage): void {
    console.log(chalk.bold("Cookies"));
    for (const name of profileNames) {
      let cookies;
      try {
        cookies = cookieStorage.load(name);
      } catch {
        console.log(`  ${chalk.cyan(name.padEnd(20))}${chalk.dim("no storage state")}`);
        continue;
      }

      const psidts = cookies.find((c) => c.name === "__Secure-1PSIDTS");
      let nextExpirySuffix = chalk.dim("no expiry (session-only)");
      if (psidts && psidts.expires > 0) {
        const expiresMs = psidts.expires * 1000;
        const ms = expiresMs - Date.now();
        const duration = formatDuration(ms);
        const dateStr = new Date(expiresMs).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        nextExpirySuffix = `${chalk.green(duration)} (${dateStr})`;
      }

      console.log(`  ${chalk.cyan(name.padEnd(20))}${cookies.length} cookies · next expiry ${nextExpirySuffix}`);
    }
  }

  private printStoragePaths(profileNames: readonly string[]): void {
    console.log(chalk.bold("Storage"));
    for (const name of profileNames) {
      const profileDir = getProfileDir(name);
      console.log(`  ${chalk.cyan(name.padEnd(20))}${profileDir}`);
    }
  }

  private showUsage(): void {
    console.log("Usage: gemiterm status");
    console.log("");
    console.log("Show configuration and profile status.");
    console.log("");
    console.log("Options:");
    console.log("  -h, --help    Show this help message");
    console.log("  -v, --verbose Show cookie ages, expiry countdown, and per-profile storage paths");
  }
}
