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

interface ExportCommandOptions {
  help: boolean;
  out: string;
  format: "markdown" | "json";
  includeMetadata: boolean;
  profile: string;
}

const DEFAULT_OPTIONS: ExportCommandOptions = {
  help: false,
  out: "",
  format: "markdown",
  includeMetadata: false,
  profile: "",
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
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case "--help":
        case "-h":
          options.help = true;
          break;
        case "--out":
        case "-o":
          options.out = args[++i] ?? "";
          break;
        case "--format":
        case "-f":
          options.format = this.parseFormat(args[++i]);
          break;
        case "--include-metadata":
          options.includeMetadata = true;
          break;
        case "--profile":
        case "-p":
          options.profile = args[++i] ?? "";
          break;
      }
    }

    return options;
  }

  private parseFormat(value: string | undefined): "markdown" | "json" {
    if (value === "markdown" || value === "json") return value;
    return DEFAULT_OPTIONS.format;
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm export <conversation_id> [options]"));
    console.log("");
    console.log(chalk.bold("Arguments:"));
    console.log(
      `  ${chalk.cyan("conversation_id".padEnd(20))}${chalk.dim("ID of the conversation to export")}`,
    );
    console.log("");
    console.log(chalk.bold("Options:"));

    const flags = [
      { flag: "--out, -o <path>", desc: "Output file path (default: gemini-chat-<id>-<date>.md)" },
      { flag: "--format, -f <fmt>", desc: "Output format: markdown, json (default: markdown)" },
      { flag: "--include-metadata", desc: "Include metadata header (ID, count, date)" },
      { flag: "--profile, -p <name>", desc: "Profile that owns the conversation (default: auto-discover)" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }
  }
}
