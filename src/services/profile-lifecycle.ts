import chalk from "chalk";
import type { ProfileStatus } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStorage, ProfileManager } from "../infrastructure/storage.ts";
import type { PlaywrightCliDriver } from "./playwright-cli-driver.ts";
import type { CookieMonitor } from "./cookie-monitor.ts";
import type { AuthService } from "./auth-service.ts";
import {
  listProfiles,
  getDefaultProfileName,
  setDefaultProfileName,
  ensureConfigDir,
  getConfigDir,
} from "../infrastructure/config.ts";
import { GemitermError } from "../core/errors.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { formatProfileTable } from "../infrastructure/formatters.ts";
import { text } from "../cli/utils/prompts.ts";

export type ProfileAction =
  | "list"
  | "create"
  | "delete"
  | "rename"
  | "set-default"
  | "status"
  | "auth";

export interface ProfileListParams {}

export interface ProfileCreateParams {
  name: string;
}

export interface ProfileDeleteParams {
  name: string;
  skipConfirm?: boolean;
}

export interface ProfileRenameParams {
  oldName: string;
  newName: string;
}

export interface ProfileSetDefaultParams {
  name: string;
}

export interface ProfileStatusParams {}

export interface ProfileAuthParams {
  profileName?: string;
  renewProfile?: string;
}

export type ProfileActionParams =
  | ProfileListParams
  | ProfileCreateParams
  | ProfileDeleteParams
  | ProfileRenameParams
  | ProfileSetDefaultParams
  | ProfileStatusParams
  | ProfileAuthParams;

export interface ProfileStatusResult {
  exitCode: 2;
}

export type ProfileLifecycleResult = void | ProfileStatusResult;

export interface ProfileLifecycleDeps {
  cookieStorage: CookieStorage;
  profileManager: ProfileManager;
  driver: PlaywrightCliDriver;
  cookieMonitor: CookieMonitor;
  authService: AuthService;
  logger: Logger;
}

type MenuSelection =
  | { type: "auth"; profileName: string }
  | { type: "renew"; profileName: string }
  | null;

const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export class ProfileLifecycle {
  private readonly profileManager: ProfileManager;
  private readonly authService: AuthService;
  private readonly logger: Logger;

  constructor(deps: ProfileLifecycleDeps) {
    this.profileManager = deps.profileManager;
    this.authService = deps.authService;
    this.logger = deps.logger;
  }

  async manageProfiles(
    action: ProfileAction,
    params: ProfileActionParams,
  ): Promise<ProfileLifecycleResult> {
    switch (action) {
      case "list":
        return this.list();
      case "create":
        return this.create(params as ProfileCreateParams);
      case "delete":
        return this.delete(params as ProfileDeleteParams);
      case "rename":
        return this.rename(params as ProfileRenameParams);
      case "set-default":
        return this.setDefault(params as ProfileSetDefaultParams);
      case "status":
        return this.status();
      case "auth":
        return this.auth(params as ProfileAuthParams);
      default:
        throw new GemitermError(
          `Unknown profile action '${action}'. Valid actions: list, create, delete, rename, set-default, status, auth.`,
        );
    }
  }

  private async list(): Promise<void> {
    this.logger.debug("Listing all profiles");
    const profileNames = await listProfiles();
    if (profileNames.length === 0) {
      console.log(chalk.dim("No profiles found. Run 'gemiterm auth' to create one."));
      return;
    }

    const statuses = await this.collectStatuses(profileNames);
    this.renderProfileTable(statuses);

    const active = statuses.filter((s) => s.isActive);
    this.logger.info(`${active.length} of ${statuses.length} profile(s) active`);
  }

  private async status(): Promise<ProfileLifecycleResult> {
    await ensureConfigDir();

    const configDir = getConfigDir();
    this.logger.debug("Config directory:", configDir);
    console.log(chalk.bold("Configuration"));
    console.log(`  Directory: ${chalk.cyan(configDir)}`);
    console.log("");

    const profileNames = await listProfiles();
    this.logger.debug("Profile scan found:", profileNames);
    if (profileNames.length === 0) {
      console.log(chalk.dim("No profiles found. Run 'gemiterm login' to create one."));
      return { exitCode: 2 };
    }

    const statuses = await this.collectStatuses(profileNames);
    this.renderProfileTable(statuses);

    const active = statuses.filter((s) => s.isActive);
    if (active.length > 0) {
      this.logger.info(`${active.length} of ${statuses.length} profile(s) active`);
    } else {
      this.logger.info("No profiles have valid sessions. Run 'gemiterm login' to authenticate.");
    }
  }

  private async create(params: ProfileCreateParams): Promise<void> {
    validateProfileName(params.name);
    this.logger.debug("Adding profile:", params.name);

    if ((await listProfiles()).includes(params.name)) {
      throw new GemitermError(`Profile '${params.name}' already exists.`);
    }

    await this.profileManager.create(params.name);
    console.log(chalk.green(`Profile '${params.name}' created.`));

    await this.authenticateWithProfile(params.name, false);
  }

  private async delete(params: ProfileDeleteParams): Promise<void> {
    const profiles = await listProfiles();
    if (!profiles.includes(params.name)) {
      throw new GemitermError(`Profile '${params.name}' does not exist.`);
    }

    this.logger.debug("Deleting profile:", params.name);

    if (!params.skipConfirm) {
      const confirmAnswer = await this.promptInput(`Delete profile '${params.name}'? [y/N]`);
      if (!confirmAnswer.toLowerCase().startsWith("y")) {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }

    await this.profileManager.delete(params.name);
    this.logger.info(`Deleted profile: ${params.name}`);
    console.log(chalk.green(`Profile '${params.name}' deleted.`));
  }

  private async rename(params: ProfileRenameParams): Promise<void> {
    const profiles = await listProfiles();
    if (!profiles.includes(params.oldName)) {
      throw new GemitermError(`Profile '${params.oldName}' does not exist.`);
    }

    validateProfileName(params.newName);
    this.logger.debug("Renaming profile:", params.oldName, "→", params.newName);

    if (profiles.includes(params.newName)) {
      throw new GemitermError(`Profile '${params.newName}' already exists.`);
    }

    await this.profileManager.rename(params.oldName, params.newName);
    this.logger.info(`Renamed profile: ${params.oldName} → ${params.newName}`);
    console.log(chalk.green(`Profile renamed: ${params.oldName} → ${params.newName}`));
  }

  private async setDefault(params: ProfileSetDefaultParams): Promise<void> {
    const profiles = await listProfiles();
    if (!profiles.includes(params.name)) {
      throw new GemitermError(`Profile '${params.name}' does not exist.`);
    }

    this.logger.debug("Setting default profile:", params.name);

    await this.profileManager.setDefault(params.name);
    await setDefaultProfileName(params.name);
    this.logger.info(`Set default profile: ${params.name}`);
    console.log(chalk.green(`Default profile set to '${params.name}'.`));
  }

  private async auth(params: ProfileAuthParams): Promise<void> {
    if (params.renewProfile) {
      const profiles = await listProfiles();
      if (!profiles.includes(params.renewProfile)) {
        throw new GemitermError(`Profile '${params.renewProfile}' does not exist.`);
      }
      this.logger.debug("Renewing profile:", params.renewProfile);
      await this.authService.renew(params.renewProfile);
      return;
    }

    if (params.profileName) {
      const profiles = await listProfiles();
      if (!profiles.includes(params.profileName)) {
        throw new GemitermError(`Profile '${params.profileName}' does not exist.`);
      }
      this.logger.debug("Authenticating with profile:", params.profileName);
      await this.authenticateWithProfile(params.profileName, false);
      return;
    }

    const profiles = await listProfiles();
    this.logger.debug("Found profiles", profiles);

    if (profiles.length === 0) {
      this.logger.debug("No profiles exist, creating first profile and authenticating");
      await this.authenticateWithProfile(await getDefaultProfileName(), true);
      return;
    }

    if (profiles.length === 1) {
      this.logger.debug("Single profile found, authenticating with", profiles[0]);
      await this.authenticateWithProfile(profiles[0], false);
      return;
    }

    const selected = await this.showProfileMenu(profiles);
    if (selected === null) {
      console.log(chalk.dim("Continuing with current default profile."));
      return;
    }

    if (selected.type === "auth") {
      this.logger.debug("Authenticating with profile", selected.profileName);
      await this.authenticateWithProfile(selected.profileName, false);
    } else if (selected.type === "renew") {
      this.logger.debug("Renewing profile", selected.profileName);
      await this.authService.renew(selected.profileName);
    }
  }

  private async showProfileMenu(profiles: string[]): Promise<MenuSelection> {
    console.log(chalk.bold("\nProfile Management"));
    console.log("");

    const statuses: ProfileStatus[] = [];
    for (const name of profiles) {
      statuses.push(await this.profileManager.getStatus(name));
    }
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
          validate: (v) => PROFILE_NAME_RE.test(v) || "Invalid profile name",
        });
        validateProfileName(name.trim());
        if ((await listProfiles()).includes(name.trim())) {
          throw new GemitermError(`Profile '${name.trim()}' already exists.`);
        }
        await this.profileManager.create(name.trim());
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
          await this.profileManager.delete(trimmed);
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
        await this.profileManager.setDefault(trimmed);
        await setDefaultProfileName(trimmed);
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
          validate: (v) => PROFILE_NAME_RE.test(v) || "Invalid profile name",
        });
        const newTrimmed = newName.trim();
        validateProfileName(newTrimmed);
        await this.profileManager.rename(oldTrimmed, newTrimmed);
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
    profileName: string,
    createFirst: boolean,
  ): Promise<void> {
    if (createFirst) {
      await this.profileManager.create(profileName);
      console.log(chalk.dim(`Created profile: ${profileName}`));
    }

    await this.authService.authenticate(profileName);
  }

  private async collectStatuses(profileNames: string[]): Promise<ProfileStatus[]> {
    const defaultName = await getDefaultProfileName();
    const statuses: ProfileStatus[] = [];
    for (const name of profileNames) {
      try {
        const status = await this.profileManager.getStatus(name);
        statuses.push({ ...status, isDefault: name === defaultName });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not read status for profile '${name}': ${message}`);
      }
    }
    return statuses;
  }

  private renderProfileTable(statuses: ProfileStatus[]): void {
    console.log(chalk.bold("Profiles"));
    console.log(formatProfileTable(statuses));
  }

  private promptInput(
    prompt: string,
    opts?: { validate?: (value: string) => boolean | string },
  ): Promise<string> {
    return text({ message: prompt, validate: opts?.validate });
  }
}
