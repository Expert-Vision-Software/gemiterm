import chalk from "chalk";
import { CookieStorage, ProfileManager } from "../../infrastructure/storage.ts";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { getConfigDir, ensureConfigDir, listProfiles, getDefaultProfileName } from "../../infrastructure/config.ts";
import { formatProfileTable } from "../../infrastructure/formatters.ts";

export class StatusCommand implements CliCommand {
  readonly name = "status";
  readonly description = "Show configuration and profile status";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("status-command");
    ensureConfigDir();

    const configDir = getConfigDir();
    console.log(chalk.bold("Configuration"));
    console.log(`  Directory: ${chalk.cyan(configDir)}`);
    console.log("");

    const profileNames = listProfiles();
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

    console.log(chalk.bold("Profiles"));
    console.log(formatProfileTable(statuses));

    const defaultName = getDefaultProfileName();
    const active = statuses.filter((s) => s.isActive);
    if (active.length > 0) {
      logger.info(`${active.length} of ${statuses.length} profile(s) active`);
    } else {
      logger.info("No profiles have valid sessions. Run 'gemiterm login' to authenticate.");
    }
  }
}
