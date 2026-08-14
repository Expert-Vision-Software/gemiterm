import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import type { ChatInfo } from "../../core/types.ts";
import { listChatsForRequest, fetchChatForRequest } from "../utils/gemini-queries.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";
import { formatChatAsMarkdown } from "../../infrastructure/formatters.ts";
import { ensureDir, writeTextFile } from "../../infrastructure/io.ts";
import { joinPath, resolvePath } from "../../infrastructure/path-utils.ts";

interface ExportAllCommandOptions {
  help: boolean;
  outDir: string;
  since: string;
  includeMetadata: boolean;
  allProfiles: boolean;
}

const EXPORT_ALL_FLAGS: readonly ArgFlagSpec[] = [
  { key: "outDir", long: "--out-dir", short: "-o", type: "string", description: "Output directory (default: ./exports)", helpLabel: "--out-dir, -o <dir>", default: "./exports" },
  { key: "since", long: "--since", type: "string", description: "Only export chats from this date onwards", helpLabel: "--since <date>", default: "" },
  { key: "includeMetadata", long: "--include-metadata", type: "boolean", description: "Include metadata headers in exports", helpLabel: "--include-metadata", default: false },
  { key: "allProfiles", long: "--all-profiles", short: "-a", type: "boolean", description: "Export conversations from all profiles", helpLabel: "--all-profiles, -a", default: false },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const EXPORT_ALL_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm export-all [options]",
  flags: EXPORT_ALL_FLAGS,
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

    logger.debug("Listing chats for export-all");

    try {
      let chats = await listChatsForRequest(context.getGeminiClient, context.listProfiles, {
        allProfiles: options.allProfiles,
      });

      chats = this.applyDateFilter(chats, options.since);

      if (chats.length === 0) {
        console.log(chalk.dim("No conversations found to export."));
        return;
      }

      console.log(chalk.bold(`Found ${chats.length} conversation${chats.length !== 1 ? "s" : ""} to export.`));
      console.log("");

      const outDir = resolvePath(options.outDir);
      ensureDir(outDir);

      const results: ExportResult[] = [];

      for (let i = 0; i < chats.length; i++) {
        const chat = chats[i];
        const progress = `[${i + 1}/${chats.length}]`;
        process.stdout.write(`  ${chalk.dim(progress)} Exporting ${chalk.cyan(chat.id)}...`);

        try {
          const messages = await fetchChatForRequest(context.getGeminiClient, chat.id, chat.profile);

          const filename = this.sanitizeFilename(chat.title || chat.id);
          const filePath = joinPath(outDir, `${filename}.md`);
          const content = formatChatAsMarkdown(
            messages,
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

      this.writeIndex(outDir, results, options.includeMetadata);
      this.printSummary(results, outDir);
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

  private writeIndex(outDir: string, results: ExportResult[], includeMetadata: boolean): void {
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

    const indexPath = joinPath(outDir, "index.md");
    writeTextFile(indexPath, lines.join("\n"));
  }

  private printSummary(results: ExportResult[], outDir: string): void {
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log("");
    console.log(chalk.bold("Export Summary:"));
    console.log(`  Exported: ${chalk.green(succeeded.length)}`);
    if (failed.length > 0) {
      console.log(`  Failed:  ${chalk.red(failed.length)}`);
    }
    console.log(`  Output:  ${outDir}`);
    console.log(`  Index:   ${chalk.cyan(joinPath(outDir, "index.md"))}`);
  }

  private parseArgs(args: string[]): ExportAllCommandOptions {
    return parseCommandArgs(args, EXPORT_ALL_FLAGS) as unknown as ExportAllCommandOptions;
  }

  private showUsage(): void {
    console.log(renderUsage(EXPORT_ALL_USAGE));
  }
}
