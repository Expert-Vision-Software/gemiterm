#!/usr/bin/env bun

import { CommandRegistry } from "./command-registry.ts";
import { Logger } from "../infrastructure/logger.ts";
import { GeminiClientService } from "../services/gemini-client-wrapper.ts";
import { ProfileLifecycle } from "../services/profile-lifecycle.ts";
import { SingleExport, BatchExport } from "../services/export-strategy.ts";
import { fetchChatForRequest } from "./utils/gemini-queries.ts";
import { runWithRotationRetry } from "./utils/rotation-await.ts";
import { createDefaultClientCache } from "./utils/default-client-cache.ts";
import { ProfileManager, CookieStorage } from "../infrastructure/storage.ts";
import { getDefaultProfileName, listProfiles } from "../infrastructure/config.ts";
import { getPackageJson } from "../infrastructure/path-utils.ts";
import { parseGlobalArgs, printVersion, printHelp } from "../infrastructure/cli-parser.ts";
import { AuthenticationError, LoginCancelledError, LoginUnroutableError } from "../core/errors.ts";
import { createCookieSession } from "../auth/cookie-session.ts";
import type { CookieSession } from "../auth/cookie-session.ts";

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
  const profileManager = new ProfileManager(new CookieStorage());

  const cookieSession = createCookieSession({
    logger,
    listProfiles,
    createProbeClient: (config, profile) =>
      new GeminiClientService(
        { secure1psid: config.secure1psid, secure1psidts: config.secure1psidts },
        logger,
        undefined,
        profile,
      ),
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

  // Default-client cache revalidation (fix-8, gap 4): the SDK client bakes
  // cookies at construction, so a process-cached instance built on a stale
  // PSIDTS cannot read with a refreshed jar. The cache re-arms cheaply on
  // every call (an in-process jar read — same cost `forProfile` already pays
  // per call) and reconstructs the `GeminiClientService` when the armed
  // PSIDTS changes; unchanged PSIDTS short-circuits to the cached instance
  // (zero added latency, zero added init — design D2).
  const clientCache = createDefaultClientCache<GeminiClientService>({
    loadArmed: async (profileName) => await cookieSession.ensureSession(profileName),
    construct: (armed, profileName) =>
      new GeminiClientService(
        { secure1psid: armed.secure_1psid, secure1psidts: armed.secure_1psidts },
        logger,
        profileCookieLoader,
        profileName,
      ),
    resolveProfile: async () => {
      const profiles = await listProfiles();
      if (profiles.length === 0) throw new AuthenticationError();
      return await getDefaultProfileName();
    },
  });

  async function getGeminiClient(): Promise<GeminiClientService> {
    return await clientCache.get();
  }

  const exportStrategies = {
    single: new SingleExport({
      fetchChat: (id, profile) => fetchChatForRequest(getGeminiClient, id, profile),
      logger: new Logger("export-command"),
    }),
    batch: new BatchExport({
      fetchChat: async (id, profile) =>
        await runWithRotationRetry(
          cookieSession,
          profile ?? await getDefaultProfileName(),
          () => fetchChatForRequest(getGeminiClient, id, profile),
          () => false,
        ),
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

  const defaultModel = flags.geminiModel ?? "gemini-3-flash";

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
      defaultModel,
    });
  } catch (error) {
    if (error instanceof LoginCancelledError) {
      logger.info(error.message);
      process.exit(0);
    }
    if (error instanceof LoginUnroutableError) {
      logger.info(error.message);
      process.exit(1);
    }
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
