import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Query } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  QUERY_TYPES,
  type FetchChatQueryPayload,
  type FetchChatQueryResult,
} from "../../core/query-handlers.ts";
import {
  formatChatAsMarkdown,
  formatChatAsJson,
} from "../../infrastructure/formatters.ts";
import { validateConversationId } from "../../infrastructure/validators.ts";
import { writeTextFile } from "../../infrastructure/io.ts";

interface ExportCommandOptions {
  help: boolean;
  output: string;
  format: "markdown" | "json";
  includeMetadata: boolean;
}

const DEFAULT_OPTIONS: ExportCommandOptions = {
  help: false,
  output: "",
  format: "markdown",
  includeMetadata: false,
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

    const mediator: Mediator = context.mediator;
    const query: FetchChatQueryPayload = { conversationId };

    logger.debug(`Sending fetch-chat query for export: ${JSON.stringify(query)}`);

    try {
      const result = await mediator.send<FetchChatQueryResult>({
        type: QUERY_TYPES.FETCH_CHAT,
        payload: query,
      } as Query<FetchChatQueryPayload>);

      const outputPath = options.output || this.defaultFilename(conversationId, options.format);

      const content =
        options.format === "json"
          ? formatChatAsJson(result.messages, conversationId)
          : formatChatAsMarkdown(result.messages, conversationId, conversationId, options.includeMetadata);

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
        case "--output":
        case "-o":
          options.output = args[++i] ?? "";
          break;
        case "--format":
        case "-f":
          options.format = this.parseFormat(args[++i]);
          break;
        case "--include-metadata":
          options.includeMetadata = true;
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
      { flag: "--output, -o <path>", desc: "Output file path (default: gemini-chat-<id>-<date>.md)" },
      { flag: "--format, -f <fmt>", desc: "Output format: markdown, json (default: markdown)" },
      { flag: "--include-metadata", desc: "Include metadata header (ID, count, date)" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }
  }
}
