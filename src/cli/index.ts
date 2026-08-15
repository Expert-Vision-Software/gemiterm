#!/usr/bin/env bun

import { CommandRegistry } from "./command-registry.ts";
import { Logger } from "../infrastructure/logger.ts";
import { GeminiClientService } from "../services/gemini-client-wrapper.ts";
import { ProfileLifecycle } from "../services/profile-lifecycle.ts";
import { SingleExport, BatchExport } from "../services/export-strategy.ts";
import { fetchChatForRequest } from "./utils/gemini-queries.ts";
import { PlaywrightCliDriver } from "../services/playwright-cli-driver.ts";
import { ProfileManager, CookieStorage } from "../infrastructure/storage.ts";
import { getDefaultProfileName, listProfiles } from "../infrastructure/config.ts";
import { getPackageJson, joinPath } from "../infrastructure/path-utils.ts";
import { parseGlobalArgs, printVersion, printHelp } from "../infrastructure/cli-parser.ts";
import { AuthenticationError } from "../core/errors.ts";
import { CookieSession } from "../auth/cookie-session.ts";
import { CookieValidator } from "../auth/cookie-validation.ts";
import { CookieStore } from "../auth/cookie-store.ts";
import { SessionClassifier } from "../auth/session-classifier.ts";
import { BrowserRefresher } from "../auth/browser-refresher.ts";
import { RecoveryRung } from "../auth/recovery.ts";

const pkgPromise = getPackageJson(import.meta.url);

interface CliServices {
  cookieSession: CookieSession;
  profileLifecycle: ProfileLifecycle;
  exportStrategies: { single: SingleExport; batch: BatchExport };
  getGeminiClient: () => Promise<GeminiClientService>;
  listProfiles: () => Promise<string[]>;
}

async function setupServices(): Promise<CliServices> {
  const logger = new Logger("cli");
  const cookieStore = new CookieStore();
  const profileManager = new ProfileManager(new CookieStorage());
  const validator = new CookieValidator({ logger });
  const driver = new PlaywrightCliDriver();
  const refresher = new BrowserRefresher({ driver, cookieStore, logger });

  let cookieSession!: CookieSession;
  const recovery = new RecoveryRung({
    refresher,
    cookieStore,
    logger,
    rearm: async (profile) => cookieSession.ensureSession(profile),
  });

  const spawnRefreshRunner = (profile: string): void => {
    try {
      const runnerPath = joinPath(import.meta.dir, "refresh-runner.ts");
      const proc = Bun.spawn([process.execPath, runnerPath, profile], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.exited.catch(() => {});
    } catch (err) {
      logger.warn(`Failed to spawn detached refresh-runner for '${profile}': ${err}`);
    }
  };

  const probeClient = async (profile: string): Promise<GeminiClientService> => {
    const { cookies } = await cookieStore.load(profile);
    const map = new Map(cookies.map((c) => [c.name, c.value]));
    return new GeminiClientService(
      { secure1psid: map.get("__Secure-1PSID") ?? "", secure1psidts: map.get("__Secure-1PSIDTS") ?? null },
      logger,
      undefined,
      profile,
    );
  };

  const classifier = new SessionClassifier({
    cookieStore,
    probeChats: async (profile) =>
      await (await probeClient(profile)).listChats({ limit: 1 }).catch(() => []),
  });

  cookieSession = new CookieSession({
    cookieStore,
    validator,
    refresher,
    classifier,
    recovery,
    logger,
    spawnRefreshRunner,
    listProfiles,
    conversationLookup: {
      profileHasConversation: async (profileName, conversationId) => {
        try {
          const chats = await (await probeClient(profileName)).listChats();
          return chats.some((chat) => chat.id === conversationId);
        } catch {
          return false;
        }
      },
    },
    driver,
  });

  const profileLifecycle = new ProfileLifecycle({
    profileManager,
    cookieSession,
    logger,
  });

  const profileCookieLoader = async (profileName: string) => {
    const armed = await cookieSession.ensureSession(profileName);
    return { secure1psid: armed.secure_1psid, secure1psidts: armed.secure_1psidts };
  };

  let geminiClient: GeminiClientService | null = null;

  async function getGeminiClient(): Promise<GeminiClientService> {
    if (geminiClient) return geminiClient;
    const profiles = await listProfiles();
    if (profiles.length === 0) {
      throw new AuthenticationError();
    }
    const profileName = await getDefaultProfileName();
    try {
      const { secure1psid, secure1psidts } = await profileCookieLoader(profileName);
      geminiClient = new GeminiClientService(
        { secure1psid, secure1psidts },
        logger,
        profileCookieLoader,
        profileName,
      );
      return geminiClient;
    } catch {
      throw new AuthenticationError();
    }
  }

  const exportStrategies = {
    single: new SingleExport({
      fetchChat: (id, profile) => fetchChatForRequest(getGeminiClient, id, profile),
      logger: new Logger("export-command"),
    }),
    batch: new BatchExport({
      fetchChat: (id, profile) => fetchChatForRequest(getGeminiClient, id, profile),
      listChatsForProfile: async (name, options) => await (await (await getGeminiClient()).forProfile(name)).listChats(options),
      listProfiles,
      logger: new Logger("export-all-command"),
    }),
  };

  return { cookieSession, profileLifecycle, exportStrategies, getGeminiClient, listProfiles };
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
    const pkg = await pkgPromise;
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
      cookieSession: services.cookieSession,
      profileLifecycle: services.profileLifecycle,
      exportStrategies: services.exportStrategies,
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
