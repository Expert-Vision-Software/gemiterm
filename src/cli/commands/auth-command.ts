import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Command } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { CookieStorage, ProfileManager } from "../../infrastructure/storage.ts";
import {
  listProfiles,
  getDefaultProfileName,
} from "../../infrastructure/config.ts";
import { GemitermError } from "../../core/errors.ts";
import { validateProfileName } from "../../infrastructure/validators.ts";
import { formatProfileTable } from "../../infrastructure/formatters.ts";
import { text } from "../utils/prompts.ts";
import {
  COMMAND_TYPES,
  type AuthenticateCommandPayload,
  type DeleteProfileCommandPayload,
  type RenameProfileCommandPayload,
  type SetDefaultProfileCommandPayload,
} from "../../core/command-handlers.ts";

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
    const mediator: Mediator = context.mediator;

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);

    if (flags.list) {
      await this.listProfiles(profileManager, logger);
      return;
    }

    if (flags.add !== null) {
      validateProfileName(flags.add);
      if (listProfiles().includes(flags.add)) {
        throw new GemitermError(`Profile '${flags.add}' already exists.`);
      }
      await mediator.send({
        type: COMMAND_TYPES.AUTHENTICATE,
        payload: { profileName: flags.add, create: true },
      } satisfies Command<AuthenticateCommandPayload>);
      return;
    }

    if (flags.delete !== null) {
      const profiles = listProfiles();
      if (!profiles.includes(flags.delete)) {
        throw new GemitermError(`Profile '${flags.delete}' does not exist.`);
      }
      if (!flags.yes) {
        const confirmAnswer = await this.promptInput(`Delete profile '${flags.delete}'? [y/N]`);
        if (!confirmAnswer.toLowerCase().startsWith("y")) {
          console.log(chalk.dim("Cancelled."));
          return;
        }
      }
      await mediator.send({
        type: COMMAND_TYPES.DELETE_PROFILE,
        payload: { profileName: flags.delete },
      } satisfies Command<DeleteProfileCommandPayload>);
      console.log(chalk.green(`Profile '${flags.delete}' deleted.`));
      return;
    }

    if (flags.rename !== null) {
      const profiles = listProfiles();
      if (!profiles.includes(flags.rename.old)) {
        throw new GemitermError(`Profile '${flags.rename.old}' does not exist.`);
      }
      validateProfileName(flags.rename.new);
      if (profiles.includes(flags.rename.new)) {
        throw new GemitermError(`Profile '${flags.rename.new}' already exists.`);
      }
      await mediator.send({
        type: COMMAND_TYPES.RENAME_PROFILE,
        payload: { oldName: flags.rename.old, newName: flags.rename.new },
      } satisfies Command<RenameProfileCommandPayload>);
      console.log(chalk.green(`Profile renamed: ${flags.rename.old} → ${flags.rename.new}`));
      return;
    }

    if (flags.default !== null) {
      const profiles = listProfiles();
      if (!profiles.includes(flags.default)) {
        throw new GemitermError(`Profile '${flags.default}' does not exist.`);
      }
      await mediator.send({
        type: COMMAND_TYPES.SET_DEFAULT_PROFILE,
        payload: { profileName: flags.default },
      } satisfies Command<SetDefaultProfileCommandPayload>);
      console.log(chalk.green(`Default profile set to '${flags.default}'.`));
      return;
    }

    if (flags.renew !== null) {
      const profiles = listProfiles();
      if (!profiles.includes(flags.renew)) {
        throw new GemitermError(`Profile '${flags.renew}' does not exist.`);
      }
      await mediator.send({
        type: COMMAND_TYPES.AUTHENTICATE,
        payload: { profileName: flags.renew, renew: true },
      } satisfies Command<AuthenticateCommandPayload>);
      return;
    }

    if (flags.profileName !== null) {
      const profiles = listProfiles();
      if (!profiles.includes(flags.profileName)) {
        throw new GemitermError(`Profile '${flags.profileName}' does not exist.`);
      }
      await mediator.send({
        type: COMMAND_TYPES.AUTHENTICATE,
        payload: { profileName: flags.profileName },
      } satisfies Command<AuthenticateCommandPayload>);
      return;
    }

    const profiles = listProfiles();
    logger.debug("Found profiles", profiles);

    if (profiles.length === 0) {
      logger.debug("No profiles exist, creating first profile and authenticating");
      await mediator.send({
        type: COMMAND_TYPES.AUTHENTICATE,
        payload: { profileName: getDefaultProfileName(), create: true },
      } satisfies Command<AuthenticateCommandPayload>);
      return;
    }

    if (profiles.length === 1) {
      logger.debug("Single profile found, authenticating with", profiles[0]);
      await mediator.send({
        type: COMMAND_TYPES.AUTHENTICATE,
        payload: { profileName: profiles[0] },
      } satisfies Command<AuthenticateCommandPayload>);
      return;
    }

    const selected = await this.showProfileMenu(profiles, profileManager, mediator);
    if (selected === null) {
      console.log(chalk.dim("Continuing with current default profile."));
      return;
    }
  }

  private async showProfileMenu(
    profiles: string[],
    profileManager: ProfileManager,
    mediator: Mediator,
  ): Promise<{ type: "auth"; profileName: string } | { type: "renew"; profileName: string } | null> {
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
        await mediator.send({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: { profileName: name.trim(), create: true },
        } satisfies Command<AuthenticateCommandPayload>);
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
          await mediator.send({
            type: COMMAND_TYPES.DELETE_PROFILE,
            payload: { profileName: trimmed },
          } satisfies Command<DeleteProfileCommandPayload>);
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
        await mediator.send({
          type: COMMAND_TYPES.SET_DEFAULT_PROFILE,
          payload: { profileName: trimmed },
        } satisfies Command<SetDefaultProfileCommandPayload>);
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
        await mediator.send({
          type: COMMAND_TYPES.RENAME_PROFILE,
          payload: { oldName: oldTrimmed, newName: newTrimmed },
        } satisfies Command<RenameProfileCommandPayload>);
        console.log(chalk.green(`Profile renamed: ${oldTrimmed} → ${newTrimmed}`));
        await mediator.send({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: { profileName: newTrimmed },
        } satisfies Command<AuthenticateCommandPayload>);
        return null;
      }
      case "E": {
        const name = await this.promptInput("Enter profile name to renew");
        const trimmed = name.trim();
        if (!profiles.includes(trimmed)) {
          throw new GemitermError(`Profile '${trimmed}' does not exist.`);
        }
        await mediator.send({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: { profileName: trimmed, renew: true },
        } satisfies Command<AuthenticateCommandPayload>);
        return { type: "renew", profileName: trimmed };
      }
      case "X":
      default:
        return null;
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
