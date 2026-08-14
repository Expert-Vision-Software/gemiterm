import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { fetchChatForRequest } from "../utils/gemini-queries.ts";
import {
  formatChatAsMarkdown,
  formatChatAsJson,
} from "../../infrastructure/formatters.ts";
import { validateConversationId } from "../../infrastructure/validators.ts";
import { writeTextFile } from "../../infrastructure/io.ts";
import { resolveProfile } from "../utils/profile-resolution.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";

interface ExportCommandOptions {
  help: boolean;
  out: string;
  format: "markdown" | "json";
  includeMetadata: boolean;
  profile: string;
}

const EXPORT_FLAGS: readonly ArgFlagSpec[] = [
  { key: "out", long: "--out", short: "-o", type: "string", description: "Output file path (default: gemini-chat-<id>-<date>.md)", helpLabel: "--out, -o <path>", default: "" },
  { key: "format", long: "--format", short: "-f", type: "enum", enum: ["markdown", "json"], description: "Output format: markdown, json (default: markdown)", helpLabel: "--format, -f <fmt>", default: "markdown" },
  { key: "includeMetadata", long: "--include-metadata", type: "boolean", description: "Include metadata header (ID, count, date)", helpLabel: "--include-metadata", default: false },
  { key: "profile", long: "--profile", short: "-p", type: "string", description: "Profile that owns the conversation (default: auto-discover)", helpLabel: "--profile, -p <name>", default: "" },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const EXPORT_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm export <conversation_id> [options]",
  arguments: [{ name: "conversation_id", description: "ID of the conversation to export" }],
  flags: EXPORT_FLAGS,
};

export class ExportCommand implements CliCommand {
  readonly name = "export";
  readonly description = "Export a conversation to a file";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("export-command");
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

    try {
      const profileName = await resolveProfile(context, conversationId, options.profile || undefined);

      logger.debug(`Fetching chat for export: ${conversationId}`);
      const messages = await fetchChatForRequest(context.getGeminiClient, conversationId, profileName ?? undefined);

      const outputPath = options.out || this.defaultFilename(conversationId, options.format);

      const content =
        options.format === "json"
          ? formatChatAsJson(messages, conversationId)
          : formatChatAsMarkdown(messages, conversationId, conversationId, options.includeMetadata);

      writeTextFile(outputPath, content);
      console.log(chalk.green(`Exported conversation '${chalk.cyan(conversationId)}' to: ${outputPath}`));
      logger.info(`Exported conversation ${conversationId} to ${outputPath}`);
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

  private defaultFilename(conversationId: string, format: "markdown" | "json"): string {
    const date = new Date().toISOString().slice(0, 10);
    const ext = format === "json" ? "json" : "md";
    return `gemini-chat-${conversationId}-${date}.${ext}`;
  }

  private parseArgs(args: string[]): ExportCommandOptions {
    return parseCommandArgs(args, EXPORT_FLAGS) as unknown as ExportCommandOptions;
  }

  private showUsage(): void {
    console.log(renderUsage(EXPORT_USAGE));
  }
}
