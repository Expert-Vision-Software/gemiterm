import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { text } from "../utils/prompts.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { CookieStorage, ProfileManager } from "../../infrastructure/storage.ts";
import { PlaywrightCliDriver } from "../../services/playwright-cli-driver.ts";
import { CookieMonitor } from "../../services/cookie-monitor.ts";
import { AuthService } from "../../services/auth-service.ts";
import {
  listProfiles,
  getDefaultProfileName,
  setDefaultProfileName,
} from "../../infrastructure/config.ts";
import { GemitermError } from "../../core/errors.ts";
import { validateProfileName } from "../../infrastructure/validators.ts";
import { formatProfileTable } from "../../infrastructure/formatters.ts";

const ACTIONS = [
  { name: "add", usage: "profile add <name>", desc: "Create new profile and authenticate" },
  { name: "delete", usage: "profile delete <name>", desc: "Delete a profile" },
  { name: "rename", usage: "profile rename <name> <newName>", desc: "Rename a profile" },
  { name: "default", usage: "profile default <name>", desc: "Set default profile" },
  { name: "list", usage: "profile list", desc: "List all profiles with status" },
] as const;

type ProfileAction = (typeof ACTIONS)[number]["name"];

export class ProfileCommand implements CliCommand {
  readonly name = "profile";
  readonly description = "Manage authentication profiles";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("profile-command");
    logger.debug("Executing profile command", args);

    if (args.includes("--help") || args.includes("-h")) {
      this.showUsage();
      return;
    }

    const action = args[0] as ProfileAction | undefined;

    if (!action) {
      this.showUsage();
      return;
    }

    const validActions = ACTIONS.map((a) => a.name);
    if (!validActions.includes(action)) {
      throw new GemitermError(
        `Unknown action '${action}'. Valid actions: ${validActions.join(", ")}`,
      );
    }

    logger.debug("Profile action:", action);

    switch (action) {
      case "add":
        await this.addProfile(args.slice(1), logger);
        break;
      case "delete":
        await this.deleteProfile(args.slice(1), logger);
        break;
      case "rename":
        await this.renameProfile(args.slice(1), logger);
        break;
      case "default":
        await this.setDefaultProfile(args.slice(1), logger);
        break;
      case "list":
        await this.listProfiles(logger);
        break;
    }
  }

  private async addProfile(args: string[], logger: Logger): Promise<void> {
    const profileName = args[0];
    if (!profileName) {
      throw new GemitermError("Usage: profile add <name>");
    }

    validateProfileName(profileName);
    logger.debug("Adding profile:", profileName);

    if (listProfiles().includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' already exists.`);
    }

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    profileManager.create(profileName);
    console.log(chalk.green(`Profile '${profileName}' created.`));

    const driver = new PlaywrightCliDriver();
    const cookieMonitor = new CookieMonitor({ driver, logger });
    const authService = new AuthService({
      driver,
      cookieMonitor,
      cookieStorage,
      logger,
    });

    await authService.authenticate(profileName);
  }

  private async deleteProfile(args: string[], logger: Logger): Promise<void> {
    const profileName = args[0];
    if (!profileName) {
      throw new GemitermError("Usage: profile delete <name>");
    }

    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }

    logger.debug("Deleting profile:", profileName);

    const confirm = await this.promptInput(`Delete profile '${profileName}'? [y/N]`);
    if (!confirm.toLowerCase().startsWith("y")) {
      console.log(chalk.dim("Cancelled."));
      return;
    }

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    profileManager.delete(profileName);
    logger.info(`Deleted profile: ${profileName}`);
    console.log(chalk.green(`Profile '${profileName}' deleted.`));
  }

  private async renameProfile(args: string[], logger: Logger): Promise<void> {
    const profileName = args[0];
    const newName = args[1];
    if (!profileName || !newName) {
      throw new GemitermError("Usage: profile rename <name> <newName>");
    }

    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }

    validateProfileName(newName);
    logger.debug("Renaming profile:", profileName, "→", newName);

    if (profiles.includes(newName)) {
      throw new GemitermError(`Profile '${newName}' already exists.`);
    }

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    profileManager.rename(profileName, newName);
    logger.info(`Renamed profile: ${profileName} → ${newName}`);
    console.log(chalk.green(`Profile renamed: ${profileName} → ${newName}`));
  }

  private async setDefaultProfile(args: string[], logger: Logger): Promise<void> {
    const profileName = args[0];
    if (!profileName) {
      throw new GemitermError("Usage: profile default <name>");
    }

    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }

    logger.debug("Setting default profile:", profileName);

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    profileManager.setDefault(profileName);
    setDefaultProfileName(profileName);
    logger.info(`Set default profile: ${profileName}`);
    console.log(chalk.green(`Default profile set to '${profileName}'.`));
  }

  private async listProfiles(logger: Logger): Promise<void> {
    logger.debug("Listing all profiles");
    const profileNames = listProfiles();
    if (profileNames.length === 0) {
      console.log(chalk.dim("No profiles found. Run 'gemiterm login' to create one."));
      return;
    }

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    const defaultName = getDefaultProfileName();
    const statuses = profileNames.map((name) => {
      const status = profileManager.getStatus(name);
      return { ...status, isDefault: name === defaultName };
    });

    console.log(chalk.bold("Profiles"));
    console.log(formatProfileTable(statuses));

    const active = statuses.filter((s) => s.isActive);
    logger.info(`${active.length} of ${statuses.length} profile(s) active`);
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm profile <action> [args]"));
    console.log("");
    console.log(chalk.bold("Actions:"));

    const maxUsageLen = Math.max(...ACTIONS.map((a) => a.usage.length));
    for (const action of ACTIONS) {
      const padded = action.usage.padEnd(maxUsageLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(action.desc)}`);
    }

    console.log("");
    console.log(chalk.dim("Run 'gemiterm profile <action> --help' for more information."));
  }

  private promptInput(prompt: string): Promise<string> {
    return text({ message: prompt });
  }
}
