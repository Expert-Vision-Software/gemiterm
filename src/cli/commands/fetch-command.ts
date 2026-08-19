import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { fetchChatForRequest } from "../utils/gemini-queries.ts";
import { runWithRotationRetry } from "../utils/rotation-await.ts";
import { resolveProfileWithRecovery } from "../utils/recovery-offer.ts";
import { getDefaultProfileName } from "../../infrastructure/config.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";
import { resolveProfile } from "../utils/profile-resolution.ts";
import { invokeCommand } from "../utils/command-invoker.ts";
import { render } from "../utils/chat-output.ts";

interface FetchCommandOptions {
  help: boolean;
  format: "text" | "json";
  out: string;
  profile: string;
}

const FETCH_FLAGS: readonly ArgFlagSpec[] = [
  { key: "format", long: "--format", short: "-f", type: "enum", enum: ["text", "json"], description: "Output format: text, json (default: text)", helpLabel: "--format, -f <fmt>", default: "text" },
  { key: "out", long: "--out", short: "-o", type: "string", description: "Write output to file", helpLabel: "--out, -o <path>", default: "" },
  { key: "profile", long: "--profile", short: "-p", type: "string", description: "Profile that owns the conversation (default: auto-discover)", helpLabel: "--profile, -p <name>", default: "" },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const FETCH_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm fetch [conversation_id] [options]",
  arguments: [{ name: "conversation_id", description: "ID of the conversation to fetch (optional)" }],
  flags: FETCH_FLAGS,
  footer: ["If no conversation_id is provided, the list command will be invoked."],
};

export class FetchCommand implements CliCommand {
  readonly name = "fetch";
  readonly description = "Fetch and display a conversation";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("fetch-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    let conversationId = this.extractConversationId(args, options);

    if (!conversationId) {
      console.log(chalk.dim("No conversation ID specified. Listing conversations:\n"));
      await invokeCommand("list", [], context);
      return;
    }

    const profileName = await resolveProfileWithRecovery(context, conversationId, options.profile || undefined);
    const rotationProfile = profileName ?? await getDefaultProfileName();

    logger.debug(`Fetching chat: ${conversationId}`);
    const messages = await runWithRotationRetry(
      context.cookieSession,
      rotationProfile,
      () => fetchChatForRequest(context.getGeminiClient, conversationId, profileName ?? undefined),
      (messages) => messages.length === 0,
    );

    await render(
      { kind: "conversation", conversationId, messages },
      { format: options.format, out: options.out || undefined },
    );
  }

  private extractConversationId(args: string[], options: FetchCommandOptions): string | null {
    for (const arg of args) {
      if (arg.startsWith("--") || arg.startsWith("-")) continue;
      return arg;
    }
    return null;
  }

  private parseArgs(args: string[]): FetchCommandOptions {
    return parseCommandArgs(args, FETCH_FLAGS) as unknown as FetchCommandOptions;
  }

  private showUsage(): void {
    console.log(renderUsage(FETCH_USAGE));
  }
}
