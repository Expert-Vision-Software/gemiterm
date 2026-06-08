import chalk from "chalk";
import { resolve, join } from "node:path";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Query } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import type { ChatInfo } from "../../core/types.ts";
import {
  QUERY_TYPES,
  type ListChatsQueryPayload,
  type ListChatsQueryResult,
  type FetchChatQueryPayload,
  type FetchChatQueryResult,
} from "../../core/query-handlers.ts";
import { formatChatAsMarkdown } from "../../infrastructure/formatters.ts";
import { ensureDir, writeTextFile } from "../../infrastructure/io.ts";

interface ExportAllCommandOptions {
  help: boolean;
  outputDir: string;
  since: string;
  includeMetadata: boolean;
  allProfiles: boolean;
}

const DEFAULT_OPTIONS: ExportAllCommandOptions = {
  help: false,
  outputDir: "./exports",
  since: "",
  includeMetadata: false,
  allProfiles: false,
};

interface ExportResult {
  id: string;
  title: string;
  filePath: string;
  success: boolean;
  error?: string;
}

export class ExportAllCommand implements CliCommand {
  readonly name = "export-all";
  readonly description = "Export all conversations to files";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("export-all-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    const mediator: Mediator = context.mediator;

    logger.debug("Sending list-chats query for export-all");

    try {
      const listResult = await mediator.send<ListChatsQueryResult>({
        type: QUERY_TYPES.LIST_CHATS,
        payload: {
          allProfiles: options.allProfiles,
        } as ListChatsQueryPayload,
      } as Query<ListChatsQueryPayload>);

      let chats = listResult.chats;

      chats = this.applyDateFilter(chats, options.since);

      if (chats.length === 0) {
        console.log(chalk.dim("No conversations found to export."));
        return;
      }

      console.log(chalk.bold(`Found ${chats.length} conversation${chats.length !== 1 ? "s" : ""} to export.`));
      console.log("");

      const outputDir = resolve(options.outputDir);
      ensureDir(outputDir);

      const results: ExportResult[] = [];

      for (let i = 0; i < chats.length; i++) {
        const chat = chats[i];
        const progress = `[${i + 1}/${chats.length}]`;
        process.stdout.write(`  ${chalk.dim(progress)} Exporting ${chalk.cyan(chat.id)}...`);

        try {
          const fetchResult = await mediator.send<FetchChatQueryResult>({
            type: QUERY_TYPES.FETCH_CHAT,
            payload: { conversationId: chat.id } as FetchChatQueryPayload,
          } as Query<FetchChatQueryPayload>);

          const filename = this.sanitizeFilename(chat.title || chat.id);
          const filePath = join(outputDir, `${filename}.md`);
          const content = formatChatAsMarkdown(
            fetchResult.messages,
            chat.title,
            chat.id,
            options.includeMetadata,
          );

          writeTextFile(filePath, content);

          results.push({ id: chat.id, title: chat.title, filePath, success: true });
          process.stdout.write(chalk.green(" OK\n"));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ id: chat.id, title: chat.title, filePath: "", success: false, error: message });
          process.stdout.write(chalk.red(" FAILED\n"));
          logger.warn(`Failed to export ${chat.id}: ${message}`);
        }
      }

      this.writeIndex(outputDir, results, options.includeMetadata);
      this.printSummary(results, outputDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  }

  private applyDateFilter(chats: ChatInfo[], since: string): ChatInfo[] {
    if (!since) return chats;
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) return chats;
    return chats.filter((chat) => new Date(chat.timestamp) >= sinceDate);
  }

  private sanitizeFilename(title: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const safe = title
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);
    return `gemini-chat-${safe}-${date}`.replace(/-+$/, "");
  }

  private writeIndex(outputDir: string, results: ExportResult[], includeMetadata: boolean): void {
    const lines: string[] = [];

    lines.push("# Exported Conversations");
    lines.push("");
    lines.push(`> Total: ${results.length}`);
    lines.push(`> Exported: ${new Date().toISOString()}`);
    lines.push("");

    if (includeMetadata) {
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      lines.push(`> Successful: ${succeeded} | Failed: ${failed}`);
      lines.push("");
    }

    lines.push("## Conversations");
    lines.push("");

    const succeeded = results.filter((r) => r.success);
    for (const result of succeeded) {
      const filename = result.filePath.split(/[\\/]/).pop() || result.filePath;
      lines.push(`- [${result.title || result.id}](${filename})`);
    }

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      lines.push("");
      lines.push("## Failed Exports");
      lines.push("");
      for (const result of failed) {
        lines.push(`- **${result.title || result.id}**: ${result.error || "Unknown error"}`);
      }
    }

    const indexPath = join(outputDir, "index.md");
    writeTextFile(indexPath, lines.join("\n"));
  }

  private printSummary(results: ExportResult[], outputDir: string): void {
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log("");
    console.log(chalk.bold("Export Summary:"));
    console.log(`  Exported: ${chalk.green(succeeded.length)}`);
    if (failed.length > 0) {
      console.log(`  Failed:  ${chalk.red(failed.length)}`);
    }
    console.log(`  Output:  ${outputDir}`);
    console.log(`  Index:   ${chalk.cyan(join(outputDir, "index.md"))}`);
  }

  private parseArgs(args: string[]): ExportAllCommandOptions {
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case "--help":
        case "-h":
          options.help = true;
          break;
        case "--output-dir":
        case "-o":
          options.outputDir = args[++i] ?? DEFAULT_OPTIONS.outputDir;
          break;
        case "--since":
          options.since = args[++i] ?? "";
          break;
        case "--include-metadata":
          options.includeMetadata = true;
          break;
        case "--all-profiles":
        case "-a":
          options.allProfiles = true;
          break;
      }
    }

    return options;
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm export-all [options]"));
    console.log("");
    console.log(chalk.bold("Options:"));

    const flags = [
      { flag: "--output-dir, -o <dir>", desc: "Output directory (default: ./exports)" },
      { flag: "--since <date>", desc: "Only export chats from this date onwards" },
      { flag: "--include-metadata", desc: "Include metadata headers in exports" },
      { flag: "--all-profiles, -a", desc: "Export conversations from all profiles" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }
  }
}
