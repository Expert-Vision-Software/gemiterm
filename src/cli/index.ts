#!/usr/bin/env bun

import { CommandRegistry } from "./command-registry.ts";
import { Logger } from "../infrastructure/logger.ts";
import { Mediator } from "../core/mediator.ts";
import { GeminiClientService } from "../services/gemini-client-wrapper.ts";
import { CookieStorageService } from "../services/cookie-storage-service.ts";
import { ProfileAuthManager } from "../services/profile-auth-manager.ts";
import { CookieStorage, ProfileManager } from "../infrastructure/storage.ts";
import { getDefaultProfileName, listProfiles } from "../infrastructure/config.ts";
import { getPackageJson } from "../infrastructure/path-utils.ts";
import { parseGlobalArgs, printVersion, printHelp } from "../infrastructure/cli-parser.ts";
import { AuthenticationError } from "../core/errors.ts";
import {
  AuthenticateCommandHandler,
  DeleteProfileCommandHandler,
  RenameProfileCommandHandler,
  SetDefaultProfileCommandHandler,
  DeleteConversationCommandHandler,
  SendMessageCommandHandler,
  StartNewChatCommandHandler,
} from "../core/command-handlers.ts";
import {
  ListChatsQueryHandler,
  FetchChatQueryHandler,
  GetProfileStatusesQueryHandler,
  GetAuthStatusQueryHandler,
  ListModelsQueryHandler,
  ProbeProfileQueryHandler,
} from "../core/query-handlers.ts";
import { PlaywrightCliDriver } from "../services/playwright-cli-driver.ts";
import { CookieMonitor } from "../services/cookie-monitor.ts";
import { AuthService } from "../services/auth-service.ts";
import { confirm } from "./utils/prompts.ts";
import { runReauthFlow } from "./utils/reauth.ts";
import { createClientServices } from "./client-services.ts";

const pkg = getPackageJson(import.meta.url);

async function setupMediator(mediator: Mediator): Promise<ProfileAuthManager> {
  const logger = new Logger("mediator");
  const cookieStorage = new CookieStorage();
  const profileManager = new ProfileManager(cookieStorage);
  const driver = new PlaywrightCliDriver();
  const cookieMonitor = new CookieMonitor({ driver, logger });
  const cookieStorageService = new CookieStorageService({ cookieStorage, logger });
  const authService = new AuthService({
    driver,
    cookieMonitor,
    cookieStorage,
    cookieStorageService,
    logger,
  });

  const profileQueryService = {
    async getProfileStatuses() {
      return profileManager.getAllStatuses();
    },
    async getAuthStatus() {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        return { authenticated: false, profileName: null };
      }
      const defaultName = getDefaultProfileName();
      const isValid = profileManager.hasValidCookies(defaultName);
      return { authenticated: isValid, profileName: defaultName };
    },
  };

  const factoryClient = new GeminiClientService({ secure1psid: "" }, logger, cookieStorageService);
  try { await factoryClient.init(); } catch { /* factory: init deferred until first real profile call */ }
  const profileAuthManager = new ProfileAuthManager({
    profileManager,
    cookieStorageService,
    logger,
    geminiClient: factoryClient,
    silentRefresh: (profileName: string, opts?: Parameters<typeof authService.silentRefresh>[1]) =>
      authService.silentRefresh(profileName, opts),
    rotateCookies: (profileName: string) => authService.rotateCookies(profileName),
  });

  let geminiClient: GeminiClientService | null = null;

  async function getGeminiClient(profileName?: string): Promise<GeminiClientService> {
    if (geminiClient && (!profileName || profileName === geminiClient.profileName)) {
      return geminiClient;
    }
    const profiles = listProfiles();
    if (profiles.length === 0) {
      throw new AuthenticationError();
    }
    const targetProfile = profileName ?? getDefaultProfileName();
    try {
      const cookies = await profileAuthManager.ensureAuthenticated(targetProfile);
      return buildClient(targetProfile, cookies);
    } catch (originalError) {
      if (!(originalError instanceof AuthenticationError)) throw originalError;
      await promptAndReauth(targetProfile, originalError);
      const cookies = await profileAuthManager.ensureAuthenticated(targetProfile);
      return buildClient(targetProfile, cookies);
    }
  }

  function buildClient(profileName: string, cookies: { secure_1psid: string; secure_1psidts: string | null }): GeminiClientService {
    const client = new GeminiClientService(
      { secure1psid: cookies.secure_1psid, secure1psidts: cookies.secure_1psidts },
      logger,
      cookieStorageService,
      profileName,
    );
    geminiClient = client;
    return client;
  }

  async function promptAndReauth(profileName: string, originalError: AuthenticationError): Promise<void> {
    await runReauthFlow(profileName, { authService, confirmPrompt: confirm, originalError });
  }

  mediator.registerQueryHandler(new GetAuthStatusQueryHandler(profileQueryService));
  mediator.registerQueryHandler(new GetProfileStatusesQueryHandler(profileQueryService));
  mediator.registerQueryHandler(new ListChatsQueryHandler(async () => getGeminiClient(), profileManager, logger));

  const { clientService, commandClientService } = createClientServices(getGeminiClient);

  mediator.registerQueryHandler(new FetchChatQueryHandler(clientService));
  mediator.registerQueryHandler(new ListModelsQueryHandler(clientService));
  mediator.registerQueryHandler(new ProbeProfileQueryHandler(getGeminiClient));

  mediator.registerCommandHandler(new AuthenticateCommandHandler(null as any));
  mediator.registerCommandHandler(new DeleteProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new RenameProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new SetDefaultProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new DeleteConversationCommandHandler(commandClientService));
  mediator.registerCommandHandler(new SendMessageCommandHandler(commandClientService));
  mediator.registerCommandHandler(new StartNewChatCommandHandler(commandClientService));

  return profileAuthManager;
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

  const mediator = new Mediator();
  const profileAuthManager = await setupMediator(mediator);

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
    await handler.execute(subcommandArgs, { verbose, mediator, profileAuthManager });
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
