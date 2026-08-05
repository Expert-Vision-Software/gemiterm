import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Command } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  COMMAND_TYPES,
  type SendMessageCommandPayload,
  type SendMessageCommandResult,
} from "../../core/command-handlers.ts";
import { runInteractiveLoop, type MessageHandlerResult } from "../utils/interactive-prompt.ts";
import { checkArgLength } from "../utils/long-arg-guard.ts";
import { loadPromptFromFile, spillOverToTempFile } from "../utils/prompt-file.ts";
import { removeFile } from "../../infrastructure/io.ts";
import { resolveProfile } from "../utils/profile-resolution.ts";

interface ContinueCommandOptions {
  help: boolean;
  promptFile: string | null;
  profile: string | null;
}

const DEFAULT_OPTIONS: ContinueCommandOptions = {
  help: false,
  promptFile: null,
  profile: null,
};

export class ContinueCommand implements CliCommand {
  readonly name = "continue";
  readonly description = "Continue a conversation";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("continue-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    let conversationId: string | null = null;
    let message: string | null = null;

    for (const arg of args) {
      if (arg.startsWith("--") || arg.startsWith("-")) continue;
      if (options.promptFile && arg === options.promptFile) continue;
      if (!conversationId) {
        conversationId = arg;
      } else if (!message) {
        message = arg;
      }
    }

    if (options.promptFile) {
      if (!conversationId) {
        console.error(
          chalk.red(
            `Error: --prompt-file requires a conversation_id. ` +
              `Specify a conversation to continue, e.g. \`gemiterm continue <conversation_id> --prompt-file <path>\`.`,
          ),
        );
        process.exit(1);
      }
      if (message) {
        console.error(
          chalk.red(
            `Error: cannot use --prompt-file together with a positional message argument. ` +
              `Use one or the other, not both.`,
          ),
        );
        process.exit(1);
      }
    }

    if (!conversationId) {
      await this.invokeListCommand(context);
      return;
    }

    const profileName = await resolveProfile(context, conversationId, options.profile ?? undefined);

    let effectivePromptFile: string | null = null;
    let isSpillover = false;
    if (options.promptFile) {
      effectivePromptFile = options.promptFile;
    } else if (message) {
      const guard = checkArgLength(message);
      if (!guard.safe) {
        const spilled = await spillOverToTempFile(message);
        effectivePromptFile = spilled;
        isSpillover = true;
        console.log(
          chalk.dim(
            `[gemiterm] Message is ${guard.length} UTF-16 code units, exceeding the ${guard.limit} limit. ` +
              `Spilled to temp file '${spilled}' and loading from there.`,
          ),
        );
      }
    }

    if (effectivePromptFile) {
      try {
        message = await loadPromptFromFile(effectivePromptFile);
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
      if (isSpillover) {
        try {
          removeFile(effectivePromptFile);
        } catch {
        }
      }
    }

    const mediator: Mediator = context.mediator;

    if (message) {
      await this.sendNonInteractive(mediator, conversationId, message, logger, context, profileName);
    } else {
      await this.startInteractive(mediator, conversationId, logger, context, profileName);
    }
  }

  private async sendNonInteractive(
    mediator: Mediator,
    conversationId: string,
    message: string,
    logger: Logger,
    _context: CliCommandContext,
    profileName: string | null,
  ): Promise<void> {
    logger.debug(`Sending message to ${conversationId}`);
    const result = await mediator.send<SendMessageCommandResult>({
      type: COMMAND_TYPES.SEND_MESSAGE,
      payload: { conversationId, message, profileName: profileName ?? undefined },
    } as Command<SendMessageCommandPayload>);

    console.log(chalk.blue.bold("Model:"));
    console.log(result.response);
  }

  private async startInteractive(
    mediator: Mediator,
    conversationId: string,
    logger: Logger,
    _context: CliCommandContext,
    profileName: string | null,
  ): Promise<void> {
    const messageHandler = async (message: string): Promise<MessageHandlerResult> => {
      logger.debug(`Sending message to ${conversationId}`);
      const result = await mediator.send<SendMessageCommandResult>({
        type: COMMAND_TYPES.SEND_MESSAGE,
        payload: { conversationId, message, profileName: profileName ?? undefined },
      } as Command<SendMessageCommandPayload>);

      return { response: result.response };
    };

    await runInteractiveLoop(messageHandler, { profileName });
  }

  private async invokeListCommand(context: CliCommandContext): Promise<void> {
    const { CommandRegistry } = await import("../command-registry.ts");
    const registry = new CommandRegistry();
    registry.registerAllCommands();

    const listHandler = registry.getHandler("list");
    if (listHandler) {
      console.log(chalk.dim("No conversation ID specified. Listing conversations:\n"));
      await listHandler.execute([], context);
    } else {
      throw new Error("Could not invoke list command.");
    }
  }

  private parseArgs(args: string[]): ContinueCommandOptions {
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--help" || arg === "-h") {
        options.help = true;
      } else if (arg === "--prompt-file" || arg === "-f") {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          options.promptFile = next;
          i++;
        } else {
          console.error(chalk.red(`Error: --prompt-file requires a path`));
          process.exit(1);
        }
      } else if (arg === "--profile" || arg === "-p") {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          options.profile = next;
          i++;
        } else {
          console.error(chalk.red(`Error: --profile requires a profile name`));
          process.exit(1);
        }
      }
    }

    return options;
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm continue [conversation_id] [message] [options]"));
    console.log("");
    console.log(chalk.bold("Arguments:"));
    console.log(
      `  ${chalk.cyan("conversation_id".padEnd(20))}${chalk.dim("ID of the conversation to continue (optional)")}`,
    );
    console.log(
      `  ${chalk.cyan("message".padEnd(20))}${chalk.dim("Message to send (optional, starts interactive mode if omitted)")}`,
    );
    console.log("");
    console.log(chalk.bold("Options:"));
    console.log(
      `  ${chalk.cyan("--prompt-file, -f <path>".padEnd(26))}${chalk.dim("Read the message from a file (bypasses the 2048 code unit arg limit)")}`,
    );
    console.log(
      `  ${chalk.cyan("--profile, -p <name>".padEnd(26))}${chalk.dim("Profile that owns the conversation (default: auto-discover)")}`,
    );
    console.log(`  ${chalk.cyan("--help, -h".padEnd(26))}${chalk.dim("Show this help message")}`);
    console.log("");
    console.log(chalk.dim("If no conversation_id is provided, the list command will be invoked."));
    console.log(chalk.dim("If no message is provided, an interactive chat session will start."));
    console.log(chalk.dim("In interactive mode, type /exit or /quit to exit."));
  }
}
