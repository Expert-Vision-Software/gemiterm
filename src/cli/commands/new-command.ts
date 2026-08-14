import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import type { GeminiClientService } from "../../services/gemini-client-wrapper.ts";
import { runInteractiveLoop, type MessageHandlerResult } from "../utils/interactive-prompt.ts";
import { loadEffectivePrompt } from "../utils/prompt-file.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";

interface NewCommandOptions {
  help: boolean;
  profile: string | null;
  promptFile: string | null;
}

const NEW_FLAGS: readonly ArgFlagSpec[] = [
  { key: "profile", long: "--profile", short: "-p", type: "string", required: true, valueName: "profile name", description: "Use a specific profile (default profile used if omitted)", helpLabel: "--profile, -p <name>", default: null },
  { key: "promptFile", long: "--prompt-file", short: "-f", type: "string", required: true, valueName: "path", description: "Read the message from a file (bypasses the 2048 code unit arg limit)", helpLabel: "--prompt-file, -f <path>", default: null },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const NEW_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm new [message] [options]",
  arguments: [{ name: "message", description: "Message to send (optional, starts interactive mode if omitted)" }],
  flags: NEW_FLAGS,
  footer: [
    "If no message is provided, an interactive chat session will start.",
    "In interactive mode, type /exit or /quit to exit.",
  ],
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

    if (options.promptFile && message) {
      console.error(
        chalk.red(
          `Error: cannot use --prompt-file together with a positional message argument. ` +
            `Use one or the other, not both.`,
        ),
      );
      process.exit(1);
    }

    message = await loadEffectivePrompt(message, options.promptFile);

    if (message) {
      await this.sendNonInteractive(context.getGeminiClient, message, options.profile, logger);
    } else {
      await this.startInteractive(context.getGeminiClient, options.profile, logger);
    }
  }

  private async sendNonInteractive(
    getGeminiClient: () => GeminiClientService,
    message: string,
    profileName: string | null,
    logger: Logger,
  ): Promise<void> {
    logger.debug("Starting new chat with message");
    const client = profileName ? getGeminiClient().forProfile(profileName) : getGeminiClient();
    const result = await client.startNewChat(message);

    console.log(chalk.cyan(`Conversation ID: ${result.conversationId}`));
    console.log(chalk.blue.bold("Model:"));
    console.log(result.response);
  }

  private async startInteractive(
    getGeminiClient: () => GeminiClientService,
    profileName: string | null,
    logger: Logger,
  ): Promise<void> {
    let conversationId: string | null = null;

    const messageHandler = async (message: string): Promise<MessageHandlerResult> => {
      const client = profileName ? getGeminiClient().forProfile(profileName) : getGeminiClient();
      const result = await client.startNewChat(message);

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
    return parseCommandArgs(args, NEW_FLAGS) as unknown as NewCommandOptions;
  }

  private showUsage(): void {
    console.log(renderUsage(NEW_USAGE));
  }
}
