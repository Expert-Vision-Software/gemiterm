#!/usr/bin/env bun

import { CommandRegistry } from "./command-registry.ts";
import { Logger } from "../infrastructure/logger.ts";
import { GeminiClientService } from "../services/gemini-client-wrapper.ts";
import { CookieStorageService } from "../services/cookie-storage-service.ts";
import { ProfileAuthManager } from "../services/profile-auth-manager.ts";
import { CookieStorage, ProfileManager } from "../infrastructure/storage.ts";
import { getDefaultProfileName, listProfiles } from "../infrastructure/config.ts";
import { getPackageJson } from "../infrastructure/path-utils.ts";
import { parseGlobalArgs, printVersion, printHelp } from "../infrastructure/cli-parser.ts";
import { AuthenticationError } from "../core/errors.ts";

const pkg = getPackageJson(import.meta.url);

interface CliServices {
  profileAuthManager: ProfileAuthManager;
  getGeminiClient: () => GeminiClientService;
  listProfiles: () => string[];
}

async function setupServices(): Promise<CliServices> {
  const logger = new Logger("cli");
  const cookieStorage = new CookieStorage();
  const profileManager = new ProfileManager(cookieStorage);
  const cookieStorageService = new CookieStorageService({ cookieStorage, logger });

  let geminiClient: GeminiClientService | null = null;

  function getGeminiClient(): GeminiClientService {
    if (geminiClient) return geminiClient;
    const profiles = listProfiles();
    if (profiles.length === 0) {
      throw new AuthenticationError();
    }
    const profileName = getDefaultProfileName();
    try {
      const cookieData = profileManager.loadCookiesForApi(profileName);
      geminiClient = new GeminiClientService(
        { secure1psid: cookieData.secure1psid, secure1psidts: cookieData.secure1psidts },
        logger,
        cookieStorageService,
        profileName,
      );
      return geminiClient;
    } catch {
      throw new AuthenticationError();
    }
  }

  const factoryClient = new GeminiClientService({ secure1psid: "" }, logger, cookieStorageService);
  try { await factoryClient.init(); } catch { /* factory: init deferred until first real profile call */ }
  const profileAuthManager = new ProfileAuthManager({ profileManager, cookieStorageService, logger, geminiClient: factoryClient });

  return { profileAuthManager, getGeminiClient, listProfiles };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const logger = new Logger("cli");

  let flags: ReturnType<typeof parseGlobalArgs>["flags"];
  let subcommand: string | null;
  let subcommandArgs: string[];
  try {
    ({ flags, subcommand, subcommandArgs } = parseGlobalArgs(args));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const verbose = flags.verbose || process.env.GEMITERM_VERBOSE === "true";
  if (verbose) {
    Logger.setVerbose(true);
  }

  if (flags.version) {
    printVersion(pkg.version);
    process.exit(0);
  }

  const registry = new CommandRegistry();
  registry.registerAllCommands();

  if (!subcommand) {
    printHelp(registry);
    process.exit(0);
  }

  const services = await setupServices();

  const handler = registry.getHandler(subcommand);
  if (!handler) {
    const known = registry.getRegisteredNames();
    if (known.length > 0) {
      console.error(`Unknown command: '${subcommand}'`);
      console.error(`Did you mean one of: ${known.join(", ")}?`);
    } else {
      console.error(`Unknown command: '${subcommand}'`);
      console.error("Run 'gemiterm --help' for available commands.");
    }
    process.exit(1);
  }

  try {
    await handler.execute(subcommandArgs, {
      verbose,
      profileAuthManager: services.profileAuthManager,
      getGeminiClient: services.getGeminiClient,
      listProfiles: services.listProfiles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Command '${subcommand}' failed: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
