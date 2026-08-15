import chalk from "chalk";
import type { ChatInfo, Message } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { formatChatAsJson, formatChatAsMarkdown, filterChatsByDate } from "../infrastructure/formatters.ts";
import { ensureDir, writeTextFile } from "../infrastructure/io.ts";
import { joinPath, resolvePath } from "../infrastructure/path-utils.ts";

export type ExportFormat = "markdown" | "json";

export interface ExportResult {
  id: string;
  title: string;
  filePath: string;
  success: boolean;
  error?: string;
}

export interface SingleExportInput {
  kind: "single";
  conversationId: string;
  messages: Message[];
  format: ExportFormat;
  out?: string;
  conversationIds?: string[];
  outDir?: string;
}

export interface BatchExportInput {
  kind: "batch";
  chats: ChatInfo[];
  outDir: string;
}

export type ExportInput = SingleExportInput | BatchExportInput;

export interface ExportOptions {
  includeMetadata?: boolean;
  since?: string;
  allProfiles?: boolean;
}

export type FetchChat = (conversationId: string, profileName?: string) => Promise<Message[]>;

export interface ListChatOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ExportStrategy {
  export(input: ExportInput, options?: ExportOptions): Promise<ExportResult[]>;
}

interface FormatConversationParams {
  messages: Message[];
  title: string;
  conversationId: string;
  format: ExportFormat;
  includeMetadata: boolean;
}

export function formatConversation(params: FormatConversationParams): string {
  const { messages, title, conversationId, format, includeMetadata } = params;
  if (format === "json") {
    return formatChatAsJson(messages, conversationId);
  }
  return formatChatAsMarkdown(messages, title, conversationId, includeMetadata);
}

export type FilenameSpec =
  | { kind: "single"; conversationId: string; format: ExportFormat }
  | { kind: "batch"; title: string };

export function filenameFor(spec: FilenameSpec): string {
  const date = new Date().toISOString().slice(0, 10);
  if (spec.kind === "single") {
    const ext = spec.format === "json" ? "json" : "md";
    return `gemini-chat-${spec.conversationId}-${date}.${ext}`;
  }
  const safe = spec.title
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return `gemini-chat-${safe}-${date}.md`.replace(/-+\.md$/, ".md");
}

interface SingleExportDeps {
  fetchChat: FetchChat;
  logger: Logger;
}

export class SingleExport implements ExportStrategy {
  private readonly fetchChat: FetchChat;
  private readonly logger: Logger;

  constructor(deps: SingleExportDeps) {
    this.fetchChat = deps.fetchChat;
    this.logger = deps.logger;
  }

  async export(input: ExportInput, options: ExportOptions = {}): Promise<ExportResult[]> {
    if (input.kind !== "single") {
      throw new Error("SingleExport can only export single-conversation input");
    }
    if (input.conversationIds && input.conversationIds.length > 0) {
      return this.exportMany(input, options);
    }
    return this.exportOne(input, options);
  }

  private async exportOne(input: SingleExportInput, options: ExportOptions): Promise<ExportResult[]> {
    const out = input.out ?? filenameFor({ kind: "single", conversationId: input.conversationId, format: input.format });
    const content = formatConversation({
      messages: input.messages,
      title: input.conversationId,
      conversationId: input.conversationId,
      format: input.format,
      includeMetadata: options.includeMetadata ?? false,
    });
    writeTextFile(out, content);
    return [{ id: input.conversationId, title: input.conversationId, filePath: out, success: true }];
  }

  private async exportMany(input: SingleExportInput, options: ExportOptions): Promise<ExportResult[]> {
    const outDir = input.outDir ?? ".";
    const results: ExportResult[] = [];
    for (const conversationId of input.conversationIds ?? []) {
      try {
        const messages = await this.fetchChat(conversationId);
        const filename = filenameFor({ kind: "single", conversationId, format: input.format });
        const filePath = joinPath(outDir, filename);
        const content = formatConversation({
          messages,
          title: conversationId,
          conversationId,
          format: input.format,
          includeMetadata: options.includeMetadata ?? false,
        });
        writeTextFile(filePath, content);
        results.push({ id: conversationId, title: conversationId, filePath, success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id: conversationId, title: conversationId, filePath: "", success: false, error: message });
        this.logger.warn(`Failed to export ${conversationId}: ${message}`);
      }
    }
    return results;
  }
}

interface BatchExportDeps {
  fetchChat: FetchChat;
  listChatsForProfile: (profileName: string, options: ListChatOptions) => Promise<ChatInfo[]>;
  listProfiles: () => string[];
  logger: Logger;
}

export class BatchExport implements ExportStrategy {
  private readonly fetchChat: FetchChat;
  private readonly listChatsForProfile: BatchExportDeps["listChatsForProfile"];
  private readonly listProfiles: BatchExportDeps["listProfiles"];
  private readonly logger: Logger;

  constructor(deps: BatchExportDeps) {
    this.fetchChat = deps.fetchChat;
    this.listChatsForProfile = deps.listChatsForProfile;
    this.listProfiles = deps.listProfiles;
    this.logger = deps.logger;
  }

  async export(input: ExportInput, options: ExportOptions = {}): Promise<ExportResult[]> {
    if (input.kind !== "batch") {
      throw new Error("BatchExport can only export batch input");
    }

    const outDir = resolvePath(input.outDir);
    let chats = input.chats;
    if (options.allProfiles) {
      chats = await this.listChatsAcrossProfiles();
    }
    chats = filterChatsByDate(chats, { since: options.since });

    if (chats.length === 0) {
      console.log(chalk.dim("No conversations found to export."));
      return [];
    }

    console.log(chalk.bold(`Found ${chats.length} conversation${chats.length !== 1 ? "s" : ""} to export.`));
    console.log("");

    ensureDir(outDir);

    const results: ExportResult[] = [];

    for (let i = 0; i < chats.length; i++) {
      const chat = chats[i];
      const progress = `[${i + 1}/${chats.length}]`;
      process.stdout.write(`  ${chalk.dim(progress)} Exporting ${chalk.cyan(chat.id)}...`);

      try {
        const messages = await this.fetchChat(chat.id, chat.profile);
        const filename = filenameFor({ kind: "batch", title: chat.title || chat.id });
        const filePath = joinPath(outDir, filename);
        const content = formatConversation({
          messages,
          title: chat.title,
          conversationId: chat.id,
          format: "markdown",
          includeMetadata: options.includeMetadata ?? false,
        });

        writeTextFile(filePath, content);

        results.push({ id: chat.id, title: chat.title, filePath, success: true });
        process.stdout.write(chalk.green(" OK\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id: chat.id, title: chat.title, filePath: "", success: false, error: message });
        process.stdout.write(chalk.red(" FAILED\n"));
        this.logger.warn(`Failed to export ${chat.id}: ${message}`);
      }
    }

    this.writeIndex(outDir, results, options.includeMetadata ?? false);
    this.printSummary(results, outDir);
    return results;
  }

  private async listChatsAcrossProfiles(): Promise<ChatInfo[]> {
    const profileNames = this.listProfiles();
    const options: ListChatOptions = {};
    const settled = await Promise.allSettled(
      profileNames.map((name) => this.listChatsForProfile(name, options)),
    );
    const chats: ChatInfo[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        chats.push(...result.value);
      } else {
        const reason = result.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        this.logger.warn(`Failed to list chats for profile '${profileNames[index]}': ${message}`);
      }
    });
    return chats.sort((a, b) => b.timestamp - a.timestamp);
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
}
