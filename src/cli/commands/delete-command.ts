import chalk from "chalk";
import { createInterface } from "node:readline";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Command } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { AuthenticationError } from "../../core/errors.ts";
import {
  COMMAND_TYPES,
  type DeleteConversationCommandPayload,
  type DeleteConversationCommandResult,
} from "../../core/command-handlers.ts";
import { validateConversationId } from "../../infrastructure/validators.ts";

interface DeleteCommandOptions {
  help: boolean;
  force: boolean;
}

const DEFAULT_OPTIONS: DeleteCommandOptions = {
  help: false,
  force: false,
};

export class DeleteCommand implements CliCommand {
  readonly name = "delete";
  readonly description = "Delete a conversation";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("delete-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    const conversationId = this.extractConversationId(args);

    if (!conversationId) {
      console.error(chalk.red("Error: conversation ID is required."));
      this.showUsage();
      process.exit(1);
    }

    try {
      validateConversationId(conversationId);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }

    const profileName = await this.resolveProfile(context, conversationId);

    if (!options.force) {
      const confirmed = await this.promptConfirmation(conversationId);
      if (!confirmed) {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }

    const mediator: Mediator = context.mediator;
    const payload: DeleteConversationCommandPayload = { conversationId, profileName: profileName ?? undefined };

    logger.debug(`Sending delete-conversation command: ${JSON.stringify(payload)}`);

    try {
      const result = await mediator.send<DeleteConversationCommandResult>({
        type: COMMAND_TYPES.DELETE_CONVERSATION,
        payload,
      } as Command<DeleteConversationCommandPayload>);

      if (result.success) {
        console.log(chalk.green(`Conversation '${chalk.cyan(conversationId)}' deleted.`));
        logger.info(`Deleted conversation: ${conversationId}`);
      } else {
        console.error(chalk.red("Failed to delete conversation."));
        process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  }

  private async resolveProfile(context: CliCommandContext, conversationId: string): Promise<string | null> {
    const profiles = context.profileAuthManager.getActiveProfiles();
    if (profiles.length <= 1) {
      return null;
    }
    const profileName = await context.profileAuthManager.findProfileForConversation(conversationId);
    if (profileName === null) {
      throw new AuthenticationError(
        `Could not find a profile that owns conversation '${conversationId}'. Run 'gemiterm list --all-profiles' to see which profile it belongs to, then 'gemiterm delete ${conversationId} --profile <name>' to specify the profile explicitly.`,
      );
    }
    return profileName;
  }

  private extractConversationId(args: string[]): string | null {
    for (const arg of args) {
      if (arg.startsWith("--") || arg.startsWith("-")) continue;
      return arg;
    }
    return null;
  }

  private parseArgs(args: string[]): DeleteCommandOptions {
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case "--help":
        case "-h":
          options.help = true;
          break;
        case "--force":
        case "-f":
          options.force = true;
          break;
      }
    }

    return options;
  }

  private promptConfirmation(conversationId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(
        `${chalk.cyan(`Delete conversation '${conversationId}'?`)} (yes/no): `,
        (answer) => {
          rl.close();
          resolve(answer.toLowerCase().startsWith("y"));
        },
      );
    });
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm delete <conversation_id> [options]"));
    console.log("");
    console.log(chalk.bold("Arguments:"));
    console.log(
      `  ${chalk.cyan("conversation_id".padEnd(20))}${chalk.dim("ID of the conversation to delete")}`,
    );
    console.log("");
    console.log(chalk.bold("Options:"));

    const flags = [
      { flag: "--force, -f", desc: "Skip confirmation prompt" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }
  }
}
