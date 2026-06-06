import chalk from "chalk";
import { createInterface } from "node:readline";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Command } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  COMMAND_TYPES,
  type SendMessageCommandPayload,
  type SendMessageCommandResult,
} from "../../core/command-handlers.ts";

interface ContinueCommandOptions {
  help: boolean;
}

const DEFAULT_OPTIONS: ContinueCommandOptions = {
  help: false,
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
      if (!conversationId) {
        conversationId = arg;
      } else if (!message) {
        message = arg;
      }
    }

    if (!conversationId) {
      await this.invokeListCommand(context);
      return;
    }

    const mediator: Mediator = context.mediator;

    if (message) {
      await this.sendNonInteractive(mediator, conversationId, message, logger);
    } else {
      await this.startInteractive(mediator, conversationId, logger);
    }
  }

  private async sendNonInteractive(
    mediator: Mediator,
    conversationId: string,
    message: string,
    logger: Logger,
  ): Promise<void> {
    logger.debug(`Sending message to ${conversationId}`);
    const result = await mediator.send<SendMessageCommandResult>({
      type: COMMAND_TYPES.SEND_MESSAGE,
      payload: { conversationId, message },
    } as Command<SendMessageCommandPayload>);

    console.log(chalk.blue.bold("Model:"));
    console.log(result.response);
  }

  private async startInteractive(
    mediator: Mediator,
    conversationId: string,
    logger: Logger,
  ): Promise<void> {
    console.log(chalk.dim(`Continuing conversation: ${chalk.cyan(conversationId)}`));
    console.log(chalk.dim("Type your message and press Enter. Type /exit to quit.\n"));

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = (): void => {
      rl.question(chalk.green.bold("You: "), async (input) => {
        const trimmed = input.trim();

        if (trimmed === "/exit" || trimmed === "/quit") {
          rl.close();
          return;
        }

        if (!trimmed) {
          prompt();
          return;
        }

        try {
          logger.debug(`Sending message to ${conversationId}`);
          const result = await mediator.send<SendMessageCommandResult>({
            type: COMMAND_TYPES.SEND_MESSAGE,
            payload: { conversationId, message: trimmed },
          } as Command<SendMessageCommandPayload>);

          console.log(chalk.blue.bold("Model:"));
          console.log(result.response);
          console.log("");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`Error: ${message}`));
          console.log("");
        }

        prompt();
      });
    };

    prompt();

    await new Promise<void>((resolve) => {
      rl.on("close", () => {
        console.log(chalk.dim("\nGoodbye."));
        resolve();
      });
    });
  }

  private async invokeListCommand(context: CliCommandContext): Promise<void> {
    const { CommandRegistry } = await import("../command-registry.ts");
    const registry = new CommandRegistry();
    await registry.autoDiscover();

    const listHandler = registry.getHandler("list");
    if (listHandler) {
      console.log(chalk.dim("No conversation ID specified. Listing conversations:\n"));
      await listHandler.execute([], context);
    } else {
      console.error("Could not invoke list command.");
      process.exit(1);
    }
  }

  private parseArgs(args: string[]): ContinueCommandOptions {
    const options = { ...DEFAULT_OPTIONS };

    for (const arg of args) {
      if (arg === "--help" || arg === "-h") {
        options.help = true;
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
    console.log(`  ${chalk.cyan("--help, -h".padEnd(22))}${chalk.dim("Show this help message")}`);
    console.log("");
    console.log(chalk.dim("If no conversation_id is provided, the list command will be invoked."));
    console.log(chalk.dim("If no message is provided, an interactive chat session will start."));
    console.log(chalk.dim("In interactive mode, type /exit or /quit to exit."));
  }
}
