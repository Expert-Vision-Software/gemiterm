import chalk from "chalk";
import { confirm } from "../utils/prompts.ts";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { validateConversationId } from "../../infrastructure/validators.ts";
import { resolveProfile } from "../utils/profile-resolution.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";

interface DeleteCommandOptions {
  help: boolean;
  force: boolean;
  profile: string;
}

const DELETE_FLAGS: readonly ArgFlagSpec[] = [
  { key: "force", long: "--force", short: "-f", type: "boolean", description: "Skip confirmation prompt", helpLabel: "--force, -f", default: false },
  { key: "profile", long: "--profile", short: "-p", type: "string", description: "Profile that owns the conversation (default: auto-discover)", helpLabel: "--profile, -p <name>", default: "" },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const DELETE_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm delete <conversation_id> [options]",
  arguments: [{ name: "conversation_id", description: "ID of the conversation to delete" }],
  flags: DELETE_FLAGS,
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

    const profileName = await resolveProfile(context, conversationId, options.profile || undefined);

    if (!options.force) {
      const confirmed = await this.promptConfirmation(conversationId);
      if (!confirmed) {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }

    logger.debug(`Deleting conversation: ${conversationId}`);

    try {
      const client = profileName
        ? context.getGeminiClient().forProfile(profileName)
        : context.getGeminiClient();
      await client.deleteChat(conversationId);

      console.log(chalk.green(`Conversation '${chalk.cyan(conversationId)}' deleted.`));
      logger.info(`Deleted conversation: ${conversationId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  }

  private extractConversationId(args: string[]): string | null {
    for (const arg of args) {
      if (arg.startsWith("--") || arg.startsWith("-")) continue;
      return arg;
    }
    return null;
  }

  private parseArgs(args: string[]): DeleteCommandOptions {
    return parseCommandArgs(args, DELETE_FLAGS) as unknown as DeleteCommandOptions;
  }

  private promptConfirmation(question: string): Promise<boolean> {
    return confirm({ message: question, default: false });
  }

  private showUsage(): void {
    console.log(renderUsage(DELETE_USAGE));
  }
}
