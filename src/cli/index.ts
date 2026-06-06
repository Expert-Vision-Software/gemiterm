#!/usr/bin/env bun

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { CommandRegistry } from "./command-registry.ts";
import { Logger } from "../infrastructure/logger.ts";
import { Mediator } from "../core/mediator.ts";
import { showHelp } from "./commands/help.ts";
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
    switch (arg) {
      case "--verbose":
      case "-v":
        flags.verbose = true;
        break;
      case "--version":
        flags.version = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      default:
        remaining.push(arg);
    }
  }

  return { flags, remaining };
}

function setupMediator(mediator: Mediator): void {
  mediator.registerQueryHandler(new GetAuthStatusQueryHandler(null as any));
  mediator.registerQueryHandler(new GetProfileStatusesQueryHandler(null as any));
  mediator.registerQueryHandler(new ListChatsQueryHandler(null as any));
  mediator.registerQueryHandler(new FetchChatQueryHandler(null as any));
  mediator.registerQueryHandler(new ListModelsQueryHandler(null as any));
  mediator.registerCommandHandler(new AuthenticateCommandHandler(null as any));
  mediator.registerCommandHandler(new DeleteProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new RenameProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new SetDefaultProfileCommandHandler(null as any));
  mediator.registerCommandHandler(new DeleteConversationCommandHandler(null as any));
  mediator.registerCommandHandler(new SendMessageCommandHandler(null as any));
  mediator.registerCommandHandler(new StartNewChatCommandHandler(null as any));
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

  if (remaining.length === 0 || flags.help) {
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
