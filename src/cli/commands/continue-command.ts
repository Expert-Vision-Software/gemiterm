import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import type { GeminiClientService } from "../../services/gemini-client-wrapper.ts";
import { fetchChatForRequest } from "../utils/gemini-queries.ts";
import { runInteractiveLoop, type MessageHandlerResult } from "../utils/interactive-prompt.ts";
import { loadEffectivePrompt } from "../utils/prompt-file.ts";
import { resolveProfile } from "../utils/profile-resolution.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";

interface ContinueCommandOptions {
  help: boolean;
  promptFile: string | null;
  profile: string | null;
}

const CONTINUE_FLAGS: readonly ArgFlagSpec[] = [
  { key: "promptFile", long: "--prompt-file", short: "-f", type: "string", required: true, valueName: "path", description: "Read the message from a file (bypasses the 2048 code unit arg limit)", helpLabel: "--prompt-file, -f <path>", default: null },
  { key: "profile", long: "--profile", short: "-p", type: "string", required: true, valueName: "profile name", description: "Profile that owns the conversation (default: auto-discover)", helpLabel: "--profile, -p <name>", default: null },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const CONTINUE_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm continue [conversation_id] [message] [options]",
  arguments: [
    { name: "conversation_id", description: "ID of the conversation to continue (optional)" },
    { name: "message", description: "Message to send (optional, starts interactive mode if omitted)" },
  ],
  flags: CONTINUE_FLAGS,
  footer: [
    "If no conversation_id is provided, the list command will be invoked.",
    "If no message is provided, an interactive chat session will start.",
    "In interactive mode, type /exit or /quit to exit.",
  ],
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

    message = await loadEffectivePrompt(message, options.promptFile);

    if (message) {
      await this.sendNonInteractive(context.getGeminiClient, conversationId, message, logger, profileName);
    } else {
      await this.startInteractive(context.getGeminiClient, conversationId, logger, profileName);
    }
  }

  private async sendNonInteractive(
    getGeminiClient: () => GeminiClientService,
    conversationId: string,
    message: string,
    logger: Logger,
    profileName: string | null,
  ): Promise<void> {
    logger.debug(`Sending message to ${conversationId}`);
    const client = profileName ? getGeminiClient().forProfile(profileName) : getGeminiClient();
    const response = await client.sendMessage(conversationId, message);

    console.log(chalk.blue.bold("Model:"));
    console.log(response);
  }

  private async startInteractive(
    getGeminiClient: () => GeminiClientService,
    conversationId: string,
    logger: Logger,
    profileName: string | null,
  ): Promise<void> {
    await this.printLastMessage(getGeminiClient, conversationId, profileName);

    const messageHandler = async (message: string): Promise<MessageHandlerResult> => {
      logger.debug(`Sending message to ${conversationId}`);
      const client = profileName ? getGeminiClient().forProfile(profileName) : getGeminiClient();
      const response = await client.sendMessage(conversationId, message);

      return { response };
    };

    await runInteractiveLoop(messageHandler, { profileName });
  }

  private async printLastMessage(
    getGeminiClient: () => GeminiClientService,
    conversationId: string,
    profileName: string | null,
  ): Promise<void> {
    const messages = await fetchChatForRequest(getGeminiClient, conversationId, profileName ?? undefined);

    const lastModelMessage = [...messages].reverse().find((m) => m.role === "model");
    if (lastModelMessage) {
      console.log(chalk.blue.bold("Last response:"));
      console.log(lastModelMessage.content);
      console.log("");
    }
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
    return parseCommandArgs(args, CONTINUE_FLAGS) as unknown as ContinueCommandOptions;
  }

  private showUsage(): void {
    console.log(renderUsage(CONTINUE_USAGE));
  }
}
