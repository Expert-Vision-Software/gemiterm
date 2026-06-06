import chalk from "chalk";
import { createInterface } from "node:readline";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { CookieStorage, ProfileManager } from "../../infrastructure/storage.ts";
import { PlaywrightCliDriver } from "../../services/playwright-cli-driver.ts";
import { CookieMonitor } from "../../services/cookie-monitor.ts";
import { AuthService } from "../../services/auth-service.ts";
import { getDefaultProfileName, listProfiles, setDefaultProfileName } from "../../infrastructure/config.ts";
import { GemitermError } from "../../core/errors.ts";
import { validateProfileName } from "../../infrastructure/validators.ts";
import { formatProfileTable } from "../../infrastructure/formatters.ts";

export class AuthCommand implements CliCommand {
  readonly name = "auth";
  readonly description = "Authenticate with Google Gemini";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("auth-command");
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

    const profiles = listProfiles();

    if (profiles.length === 0) {
      await this.authenticateWithProfile(authService, getDefaultProfileName(), profileManager, true);
      return;
    }

    if (profiles.length === 1) {
      await this.authenticateWithProfile(authService, profiles[0], profileManager, false);
      return;
    }

    const selected = await this.showProfileMenu(profiles, profileManager);
    if (selected === null) {
      console.log(chalk.dim("Continuing with current default profile."));
      return;
    }

    if (selected.type === "auth") {
      await this.authenticateWithProfile(authService, selected.profileName, profileManager, false);
    }
  }

  private async showProfileMenu(
    profiles: string[],
    profileManager: ProfileManager,
  ): Promise<{ type: "auth"; profileName: string } | null> {
    console.log(chalk.bold("\nProfile Management"));
    console.log("");

    const statuses = profiles.map((name) => profileManager.getStatus(name));
    console.log(formatProfileTable(statuses));

    const options = [
      { key: "A", label: "Add new profile" },
      { key: "D", label: "Delete profile" },
      { key: "S", label: "Set default" },
      { key: "R", label: "Rename profile" },
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
        const name = await this.promptInput("Enter profile name");
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
        const confirm = await this.promptInput(`Delete profile '${trimmed}'? [y/N]`);
        if (confirm.toLowerCase().startsWith("y")) {
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
        const newName = await this.promptInput("Enter new profile name");
        const newTrimmed = newName.trim();
        validateProfileName(newTrimmed);
        profileManager.rename(oldTrimmed, newTrimmed);
        console.log(chalk.green(`Profile renamed: ${oldTrimmed} → ${newTrimmed}`));
        return { type: "auth", profileName: newTrimmed };
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

  private promptInput(prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`${chalk.cyan(prompt + ": ")} `, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
