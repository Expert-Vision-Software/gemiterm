import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Command } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  COMMAND_TYPES,
  type StartNewChatCommandPayload,
  type StartNewChatCommandResult,
} from "../../core/command-handlers.ts";
import { runInteractiveLoop, type MessageHandlerResult } from "../utils/interactive-prompt.ts";
import { checkArgLength } from "../utils/long-arg-guard.ts";
import { loadPromptFromFile } from "../utils/prompt-file.ts";

interface NewCommandOptions {
  help: boolean;
  profile: string | null;
  promptFile: string | null;
}

const DEFAULT_OPTIONS: NewCommandOptions = {
  help: false,
  profile: null,
  promptFile: null,
};

export class NewCommand implements CliCommand {
  readonly name = "new";
  readonly description = "Start a new conversation";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("new-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    let message: string | null = null;

    for (const arg of args) {
      if (arg.startsWith("--") || arg.startsWith("-")) continue;
      if (options.profile && arg === options.profile) continue;
      if (options.promptFile && arg === options.promptFile) continue;
      if (!message) {
        message = arg;
      }
    }

    if (options.promptFile) {
      if (message) {
        console.error(
          chalk.red(
            `Error: cannot use --prompt-file together with a positional message argument. ` +
              `Use one or the other, not both.`,
          ),
        );
        process.exit(1);
      }
      try {
        message = await loadPromptFromFile(options.promptFile);
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    }

    const mediator: Mediator = context.mediator;

    if (message) {
      if (!options.promptFile) {
        const guard = checkArgLength(message);
        if (!guard.safe) {
          console.error(chalk.red(`Error: ${guard.suggestion}`));
          process.exit(1);
        }
      }
      await this.sendNonInteractive(mediator, message, options.profile, logger);
    } else {
      await this.startInteractive(mediator, options.profile, logger);
    }
  }

  private async sendNonInteractive(
    mediator: Mediator,
    message: string,
    profileName: string | null,
    logger: Logger,
  ): Promise<void> {
    logger.debug("Starting new chat with message");
    const payload: StartNewChatCommandPayload = { message };
    if (profileName) {
      payload.profileName = profileName;
    }

    const result = await mediator.send<StartNewChatCommandResult>({
      type: COMMAND_TYPES.START_NEW_CHAT,
      payload,
    } as Command<StartNewChatCommandPayload>);

    console.log(chalk.cyan(`Conversation ID: ${result.conversationId}`));
    console.log(chalk.blue.bold("Model:"));
    console.log(result.response);
  }

  private async startInteractive(
    mediator: Mediator,
    profileName: string | null,
    logger: Logger,
  ): Promise<void> {
    let conversationId: string | null = null;

    const messageHandler = async (message: string): Promise<MessageHandlerResult> => {
      const payload: StartNewChatCommandPayload = { message };
      if (profileName) {
        payload.profileName = profileName;
      }

      const result = await mediator.send<StartNewChatCommandResult>({
        type: COMMAND_TYPES.START_NEW_CHAT,
        payload,
      } as Command<StartNewChatCommandPayload>);

      const isFirst = !conversationId;
      if (isFirst) {
        conversationId = result.conversationId;
        console.log(chalk.dim(`Conversation started: ${chalk.cyan(conversationId)}`));
      } else {
        console.log(chalk.dim(`Response from: ${chalk.cyan(result.conversationId)}`));
      }

      return { response: result.response };
    };

    await runInteractiveLoop(messageHandler, { profileName });
  }

  private parseArgs(args: string[]): NewCommandOptions {
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--help" || arg === "-h") {
        options.help = true;
      } else if (arg === "--profile" || arg === "-p") {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          options.profile = next;
          i++;
        } else {
          console.error(chalk.red(`Error: --profile requires a profile name`));
          process.exit(1);
        }
      } else if (arg === "--prompt-file" || arg === "-f") {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          options.promptFile = next;
          i++;
        } else {
          console.error(chalk.red(`Error: --prompt-file requires a path`));
          process.exit(1);
        }
      }
    }

    return options;
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm new [message] [options]"));
    console.log("");
    console.log(chalk.bold("Arguments:"));
    console.log(
      `  ${chalk.cyan("message".padEnd(20))}${chalk.dim("Message to send (optional, starts interactive mode if omitted)")}`,
    );
    console.log("");
    console.log(chalk.bold("Options:"));
    console.log(
      `  ${chalk.cyan("--profile, -p <name>".padEnd(22))}${chalk.dim("Use a specific profile (default profile used if omitted)")}`,
    );
    console.log(
      `  ${chalk.cyan("--prompt-file, -f <path>".padEnd(22))}${chalk.dim("Read the message from a file (bypasses the 2048 code unit arg limit)")}`,
    );
    console.log(`  ${chalk.cyan("--help, -h".padEnd(22))}${chalk.dim("Show this help message")}`);
    console.log("");
    console.log(chalk.dim("If no message is provided, an interactive chat session will start."));
    console.log(chalk.dim("In interactive mode, type /exit or /quit to exit."));
  }
}
