#!/usr/bin/env bun

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { CommandRegistry } from "./command-registry.ts";
import { Logger } from "../infrastructure/logger.ts";
import { Mediator } from "../core/mediator.ts";
import { showHelp } from "./commands/help.ts";
import { GeminiClientService } from "../services/gemini-client-wrapper.ts";
import { CookieStorage, ProfileManager } from "../infrastructure/storage.ts";
import { getDefaultProfileName, listProfiles, ensureConfigDir } from "../infrastructure/config.ts";
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
} from "../core/query-handlers.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"));

interface GlobalFlags {
  verbose: boolean;
  version: boolean;
  help: boolean;
}

function parseGlobalFlags(args: string[]): { flags: GlobalFlags; remaining: string[] } {
  const flags: GlobalFlags = { verbose: false, version: false, help: false };
  const remaining: string[] = [];

  for (const arg of args) {
    if (arg === "--verbose" || arg === "-v") {
      flags.verbose = true;
    } else if (arg === "--version") {
      flags.version = true;
    } else if (arg === "--help" || arg === "-h") {
      if (remaining.length === 0) {
        flags.help = true;
      } else {
        remaining.push(arg);
      }
    } else {
      remaining.push(arg);
    }
  }

  return { flags, remaining };
}

function setupMediator(mediator: Mediator): void {
  const logger = new Logger("mediator");
  const cookieStorage = new CookieStorage();
  const profileManager = new ProfileManager(cookieStorage);

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
      );
      return geminiClient;
    } catch {
      throw new AuthenticationError();
    }
  }

  mediator.registerQueryHandler(new GetAuthStatusQueryHandler(profileQueryService));
  mediator.registerQueryHandler(new GetProfileStatusesQueryHandler(profileQueryService));
  mediator.registerQueryHandler(new ListChatsQueryHandler({
    async listChats(options) { return getGeminiClient().listChats(options); },
    async fetchChat(id) { return getGeminiClient().fetchChat(id); },
    async listModels() { return getGeminiClient().listModels(); },
  }));
  mediator.registerQueryHandler(new FetchChatQueryHandler({
    async listChats(options) { return getGeminiClient().listChats(options); },
    async fetchChat(id) { return getGeminiClient().fetchChat(id); },
    async listModels() { return getGeminiClient().listModels(); },
  }));
  mediator.registerQueryHandler(new ListModelsQueryHandler({
    async listChats(options) { return getGeminiClient().listChats(options); },
    async fetchChat(id) { return getGeminiClient().fetchChat(id); },
    async listModels() { return getGeminiClient().listModels(); },
  }));
  mediator.registerCommandHandler(new AuthenticateCommandHandler(null as any));
  mediator.registerCommandHandler(new DeleteProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new RenameProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new SetDefaultProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new DeleteConversationCommandHandler({
    async deleteChat(id) { return getGeminiClient().deleteChat(id); },
    async sendMessage(id, msg) { return getGeminiClient().sendMessage(id, msg); },
    async startNewChat(msg) { return getGeminiClient().startNewChat(msg); },
  }));
  mediator.registerCommandHandler(new SendMessageCommandHandler({
    async deleteChat(id) { return getGeminiClient().deleteChat(id); },
    async sendMessage(id, msg) { return getGeminiClient().sendMessage(id, msg); },
    async startNewChat(msg) { return getGeminiClient().startNewChat(msg); },
  }));
  mediator.registerCommandHandler(new StartNewChatCommandHandler({
    async deleteChat(id) { return getGeminiClient().deleteChat(id); },
    async sendMessage(id, msg) { return getGeminiClient().sendMessage(id, msg); },
    async startNewChat(msg) { return getGeminiClient().startNewChat(msg); },
  }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const logger = new Logger("cli");
  const { flags, remaining } = parseGlobalFlags(args);

  if (flags.verbose) {
    Logger.setVerbose(true);
  }

  if (flags.version) {
    console.log(`gemiterm v${pkg.version}`);
    process.exit(0);
  }

  const registry = new CommandRegistry();
  registry.registerAllCommands();

  if (remaining.length === 0) {
    showHelp(registry);
    process.exit(0);
  }

  const mediator = new Mediator();
  setupMediator(mediator);

  const subcommand = remaining[0];
  const subcommandArgs = remaining.slice(1);

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
    await handler.execute(subcommandArgs, { verbose: flags.verbose, mediator });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Command '${subcommand}' failed: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
