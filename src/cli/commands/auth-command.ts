import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
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
import { text } from "../utils/prompts.ts";

interface ParsedFlags {
  list: boolean;
  add: string | null;
  delete: string | null;
  rename: { old: string; new: string } | null;
  default: string | null;
  renew: string | null;
  yes: boolean;
  profileName: string | null;
}

export class AuthCommand implements CliCommand {
  readonly name = "auth";
  readonly description = "Authenticate with Google Gemini";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    if (args.includes("--help") || args.includes("-h")) {
      this.showUsage();
      return;
    }

    const logger = new Logger("auth-command");
    logger.debug("Executing auth command", args);

    const flags = this.parseFlags(args);

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    const driver = new PlaywrightCliDriver();
    const cookieMonitor = new CookieMonitor({ driver, logger });
    const authService = new AuthService({
      driver,
      cookieMonitor,
      cookieStorage,
      logger,
    });

    if (flags.list) {
      await this.listProfiles(profileManager, logger);
      return;
    }

    if (flags.add !== null) {
      await this.addProfile(flags.add, profileManager, authService, logger);
      return;
    }

    if (flags.delete !== null) {
      await this.deleteProfile(flags.delete, flags.yes, profileManager, logger);
      return;
    }

    if (flags.rename !== null) {
      await this.renameProfile(flags.rename.old, flags.rename.new, profileManager, logger);
      return;
    }

    if (flags.default !== null) {
      await this.setDefaultProfile(flags.default, profileManager, logger);
      return;
    }

    if (flags.renew !== null) {
      await this.renewProfile(flags.renew, authService, logger);
      return;
    }

    if (flags.profileName !== null) {
      await this.authenticateToProfile(flags.profileName, profileManager, authService, logger);
      return;
    }

    const profiles = listProfiles();
    logger.debug("Found profiles", profiles);

    if (profiles.length === 0) {
      logger.debug("No profiles exist, creating first profile and authenticating");
      await this.authenticateWithProfile(authService, getDefaultProfileName(), profileManager, true);
      return;
    }

    if (profiles.length === 1) {
      logger.debug("Single profile found, authenticating with", profiles[0]);
      await this.authenticateWithProfile(authService, profiles[0], profileManager, false);
      return;
    }

    const selected = await this.showProfileMenu(profiles, profileManager);
    if (selected === null) {
      console.log(chalk.dim("Continuing with current default profile."));
      return;
    }

    if (selected.type === "auth") {
      logger.debug("Authenticating with profile", selected.profileName);
      await this.authenticateWithProfile(authService, selected.profileName, profileManager, false);
    } else if (selected.type === "renew") {
      logger.debug("Renewing profile", selected.profileName);
      await authService.renew(selected.profileName);
    }
  }

  private parseFlags(args: string[]): ParsedFlags {
    const flags: ParsedFlags = {
      list: false,
      add: null,
      delete: null,
      rename: null,
      default: null,
      renew: null,
      yes: false,
      profileName: null,
    };

    const remaining: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--list" || arg === "-l") {
        flags.list = true;
      } else if (arg === "--yes" || arg === "-y") {
        flags.yes = true;
      } else if (arg === "--add" || arg === "-a") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.add = args[++i];
        }
      } else if (arg === "--delete" || arg === "-d") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.delete = args[++i];
        }
      } else if (arg === "--rename" || arg === "-r") {
        if (i + 2 < args.length && !args[i + 1].startsWith("-") && !args[i + 2].startsWith("-")) {
          flags.rename = { old: args[++i], new: args[++i] };
        }
      } else if (arg === "--default" || arg === "-s") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.default = args[++i];
        }
      } else if (arg === "--renew" || arg === "-e") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.renew = args[++i];
        }
      } else if (!arg.startsWith("-")) {
        remaining.push(arg);
      }
    }

    if (remaining.length > 0) {
      flags.profileName = remaining[0];
    }

    return flags;
  }

  private async listProfiles(profileManager: ProfileManager, logger: Logger): Promise<void> {
    logger.debug("Listing all profiles");
    const profileNames = listProfiles();
    if (profileNames.length === 0) {
      console.log(chalk.dim("No profiles found. Run 'gemiterm auth' to create one."));
      return;
    }

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

  private async addProfile(
    profileName: string,
    profileManager: ProfileManager,
    authService: AuthService,
    logger: Logger,
  ): Promise<void> {
    validateProfileName(profileName);
    logger.debug("Adding profile:", profileName);

    if (listProfiles().includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' already exists.`);
    }

    profileManager.create(profileName);
    console.log(chalk.green(`Profile '${profileName}' created.`));

    await this.authenticateWithProfile(authService, profileName, profileManager, false);
  }

  private async deleteProfile(
    profileName: string,
    skipConfirm: boolean,
    profileManager: ProfileManager,
    logger: Logger,
  ): Promise<void> {
    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }

    logger.debug("Deleting profile:", profileName);

    if (!skipConfirm) {
      const confirmAnswer = await this.promptInput(`Delete profile '${profileName}'? [y/N]`);
      if (!confirmAnswer.toLowerCase().startsWith("y")) {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }

    profileManager.delete(profileName);
    logger.info(`Deleted profile: ${profileName}`);
    console.log(chalk.green(`Profile '${profileName}' deleted.`));
  }

  private async renameProfile(
    profileName: string,
    newName: string,
    profileManager: ProfileManager,
    logger: Logger,
  ): Promise<void> {
    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }

    validateProfileName(newName);
    logger.debug("Renaming profile:", profileName, "→", newName);

    if (profiles.includes(newName)) {
      throw new GemitermError(`Profile '${newName}' already exists.`);
    }

    profileManager.rename(profileName, newName);
    logger.info(`Renamed profile: ${profileName} → ${newName}`);
    console.log(chalk.green(`Profile renamed: ${profileName} → ${newName}`));
  }

  private async setDefaultProfile(
    profileName: string,
    profileManager: ProfileManager,
    logger: Logger,
  ): Promise<void> {
    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }

    logger.debug("Setting default profile:", profileName);

    profileManager.setDefault(profileName);
    setDefaultProfileName(profileName);
    logger.info(`Set default profile: ${profileName}`);
    console.log(chalk.green(`Default profile set to '${profileName}'.`));
  }

  private async renewProfile(
    profileName: string,
    authService: AuthService,
    logger: Logger,
  ): Promise<void> {
    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }
    logger.debug("Renewing profile:", profileName);
    await authService.renew(profileName);
  }

  private async authenticateToProfile(
    profileName: string,
    profileManager: ProfileManager,
    authService: AuthService,
    logger: Logger,
  ): Promise<void> {
    const profiles = listProfiles();
    if (!profiles.includes(profileName)) {
      throw new GemitermError(`Profile '${profileName}' does not exist.`);
    }
    logger.debug("Authenticating with profile:", profileName);
    await this.authenticateWithProfile(authService, profileName, profileManager, false);
  }

  private async showProfileMenu(
    profiles: string[],
    profileManager: ProfileManager,
  ): Promise<
    { type: "auth"; profileName: string } | { type: "renew"; profileName: string } | null
  > {
    console.log(chalk.bold("\nProfile Management"));
    console.log("");

    const statuses = profiles.map((name) => profileManager.getStatus(name));
    console.log(formatProfileTable(statuses));

    const options = [
      { key: "A", label: "Add new profile" },
      { key: "D", label: "Delete profile" },
      { key: "S", label: "Set default" },
      { key: "R", label: "Rename profile" },
      { key: "E", label: "Renew session (extend/refresh cookies)" },
      { key: "X", label: "Exit and continue with current default" },
    ];

    for (const opt of options) {
      console.log(`  ${chalk.cyan(`[${opt.key}]`)} ${opt.label}`);
    }
    console.log("");

    const answer = await this.promptInput("Select an option");
    const choice = answer.toUpperCase().trim();

    switch (choice) {
      case "A": {
        const name = await this.promptInput("Enter profile name", {
          validate: (v) => /^[a-zA-Z0-9_-]+$/.test(v) || "Invalid profile name",
        });
        validateProfileName(name.trim());
        if (listProfiles().includes(name.trim())) {
          throw new GemitermError(`Profile '${name.trim()}' already exists.`);
        }
        profileManager.create(name.trim());
        console.log(chalk.green(`Profile '${name.trim()}' created.`));
        return { type: "auth", profileName: name.trim() };
      }
      case "D": {
        const name = await this.promptInput("Enter profile name to delete");
        const trimmed = name.trim();
        if (!profiles.includes(trimmed)) {
          throw new GemitermError(`Profile '${trimmed}' does not exist.`);
        }
        const confirmAnswer = await this.promptInput(`Delete profile '${trimmed}'? [y/N]`);
        if (confirmAnswer.toLowerCase().startsWith("y")) {
          profileManager.delete(trimmed);
          console.log(chalk.green(`Profile '${trimmed}' deleted.`));
        } else {
          console.log(chalk.dim("Cancelled."));
        }
        return null;
      }
      case "S": {
        const name = await this.promptInput("Enter profile name to set as default");
        const trimmed = name.trim();
        if (!profiles.includes(trimmed)) {
          throw new GemitermError(`Profile '${trimmed}' does not exist.`);
        }
        profileManager.setDefault(trimmed);
        setDefaultProfileName(trimmed);
        console.log(chalk.green(`Default profile set to '${trimmed}'.`));
        return null;
      }
      case "R": {
        const oldName = await this.promptInput("Enter current profile name");
        const oldTrimmed = oldName.trim();
        if (!profiles.includes(oldTrimmed)) {
          throw new GemitermError(`Profile '${oldTrimmed}' does not exist.`);
        }
        const newName = await this.promptInput("Enter new profile name", {
          validate: (v) => /^[a-zA-Z0-9_-]+$/.test(v) || "Invalid profile name",
        });
        const newTrimmed = newName.trim();
        validateProfileName(newTrimmed);
        profileManager.rename(oldTrimmed, newTrimmed);
        console.log(chalk.green(`Profile renamed: ${oldTrimmed} → ${newTrimmed}`));
        return { type: "auth", profileName: newTrimmed };
      }
      case "E": {
        const name = await this.promptInput("Enter profile name to renew");
        const trimmed = name.trim();
        if (!profiles.includes(trimmed)) {
          throw new GemitermError(`Profile '${trimmed}' does not exist.`);
        }
        return { type: "renew", profileName: trimmed };
      }
      case "X":
      default:
        return null;
    }
  }

  private async authenticateWithProfile(
    authService: AuthService,
    profileName: string,
    profileManager: ProfileManager,
    createFirst: boolean,
  ): Promise<void> {
    if (createFirst) {
      profileManager.create(profileName);
      console.log(chalk.dim(`Created profile: ${profileName}`));
    }

    await authService.authenticate(profileName);
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm auth [profileName] [options]"));
    console.log("");
    console.log("Authenticate with Google Gemini.");
    console.log("");
    console.log("Arguments:");
    console.log("  profileName              Authenticate to an existing profile directly");
    console.log("");
    console.log("Options:");
    console.log("  -h, --help                Show this help message");
    console.log("  -l, --list                List all profiles (non-interactive)");
    console.log("  -a, --add <name>          Create a new profile and authenticate");
    console.log("  -d, --delete <name>      Delete a profile");
    console.log("  -y, --yes                 Skip confirmation prompts");
    console.log("  -r, --rename <old> <new>  Rename a profile");
    console.log("  -s, --default <name>     Set default profile");
    console.log("  -e, --renew <name>       Renew session (extend/refresh cookies)");
  }

  private promptInput(
    prompt: string,
    opts?: { validate?: (value: string) => boolean | string },
  ): Promise<string> {
    return text({ message: prompt, validate: opts?.validate });
  }
}
