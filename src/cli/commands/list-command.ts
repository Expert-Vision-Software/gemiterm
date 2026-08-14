import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { listChatsForRequest } from "../utils/gemini-queries.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";
import { formatChatList } from "../../infrastructure/formatters.ts";
import type { ChatInfo } from "../../core/types.ts";
import { writeTextFile } from "../../infrastructure/io.ts";
import { GemitermError } from "../../core/errors.ts";
import { browser, select, text, type BrowserAction } from "../utils/prompts.ts";

interface ListCommandOptions {
  help: boolean;
  limit: number;
  offset: number;
  allProfiles: boolean;
  profile: string;
  sort: "recent" | "oldest" | "alpha";
  search: string;
  after: string;
  before: string;
  format: "text" | "json";
  out: string;
  interactive: boolean;
}

const DEFAULT_OPTIONS: ListCommandOptions = {
  help: false,
  limit: 0,
  offset: 0,
  allProfiles: false,
  profile: "",
  sort: "recent",
  search: "",
  after: "",
  before: "",
  format: "text",
  out: "",
  interactive: false,
};

const LIST_FLAGS: readonly ArgFlagSpec[] = [
  { key: "limit", long: "--limit", short: "-n", type: "integer", description: "Limit number of results (no limit by default)", helpLabel: "--limit, -n N", default: 0 },
  { key: "offset", long: "--offset", type: "integer", description: "Skip N results (default: 0)", helpLabel: "--offset N", default: 0 },
  { key: "allProfiles", long: "--all-profiles", type: "boolean", description: "Show conversations from all profiles (with Profile column in text output)", helpLabel: "--all-profiles", default: false },
  { key: "profile", long: "--profile", short: "-p", type: "string", description: "Filter conversations to a specific profile (non-interactive)", helpLabel: "--profile, -p <name>", default: "" },
  { key: "sort", long: "--sort", type: "enum", enum: ["recent", "oldest", "alpha"], description: "Sort order: recent, oldest, alpha (default: recent)", helpLabel: "--sort <mode>", default: "recent" },
  { key: "search", long: "--search", short: "-s", type: "string", description: "Filter by title search", helpLabel: "--search, -s <query>", default: "" },
  { key: "after", long: "--after", type: "string", description: "Only show chats after this date", helpLabel: "--after <date>", default: "" },
  { key: "before", long: "--before", type: "string", description: "Only show chats before this date", helpLabel: "--before <date>", default: "" },
  { key: "format", long: "--format", short: "-f", type: "enum", enum: ["text", "json"], description: "Output format: text, json (default: text)", helpLabel: "--format, -f <fmt>", default: "text" },
  { key: "out", long: "--out", short: "-o", type: "string", description: "Write output to file", helpLabel: "--out, -o <path>", default: "" },
  { key: "interactive", long: "--interactive", short: "-i", type: "boolean", description: "Open interactive chat-list browser (TTY only; shows all profiles by default)", helpLabel: "--interactive, -i", default: false },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const LIST_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm list [options]",
  flags: LIST_FLAGS,
};

export class ListCommand implements CliCommand {
  readonly name = "list";
  readonly description = "List conversations";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("list-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    const hasLimit = options.limit > 0;
    const request = {
      limit: hasLimit ? options.limit : undefined,
      offset: options.offset || undefined,
      search: options.search || undefined,
      allProfiles: options.allProfiles,
      profile: options.profile || undefined,
    };

    logger.debug(`Listing chats: ${JSON.stringify(request)}`);
    let chats = await listChatsForRequest(context.getGeminiClient, context.listProfiles, request);

    if (options.interactive) {
      await this.runInteractiveBrowser(chats, options, context);
      return;
    }

    chats = this.applySort(chats, options.sort);
    chats = this.applyDateFilter(chats, options.after, options.before);

    if (hasLimit) {
      chats = chats.slice(options.offset, options.offset + options.limit);
    } else if (options.offset > 0) {
      chats = chats.slice(options.offset);
    }

    if (options.format === "json") {
      this.outputJson(chats, options.out);
    } else {
      this.outputText(chats, options.out, options.allProfiles || Boolean(options.profile));
    }
  }

  private applySort(chats: ChatInfo[], sort: "recent" | "oldest" | "alpha"): ChatInfo[] {
    const sorted = [...chats];
    switch (sort) {
      case "recent":
        sorted.sort((a, b) => b.timestamp - a.timestamp);
        break;
      case "oldest":
        sorted.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case "alpha":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return sorted;
  }

  private applyDateFilter(chats: ChatInfo[], after: string, before: string): ChatInfo[] {
    return chats.filter((chat) => {
      const chatDate = new Date(chat.timestamp);
      if (after) {
        const afterDate = new Date(after);
        if (isNaN(afterDate.getTime())) return true;
        if (chatDate < afterDate) return false;
      }
      if (before) {
        const beforeDate = new Date(before);
        if (isNaN(beforeDate.getTime())) return true;
        if (chatDate > beforeDate) return false;
      }
      return true;
    });
  }

  private outputJson(chats: ChatInfo[], out: string): void {
    const output = JSON.stringify({ chats }, null, 2);
    if (out) {
      this.writeOutput(out, output);
    } else {
      console.log(output);
    }
  }

  private outputText(chats: ChatInfo[], out: string, allProfiles: boolean): void {
    const output = formatChatList(chats, { includeProfileColumn: allProfiles });
    if (out) {
      this.writeOutput(out, output);
    } else {
      console.log(output);
    }
  }

  private writeOutput(out: string, content: string): void {
    writeTextFile(out, content);
    console.log(chalk.dim(`Output written to: ${out}`));
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    const cmd = process.platform === "win32"
      ? ["clip"]
      : process.platform === "darwin"
        ? ["pbcopy"]
        : ["xclip", "-selection", "clipboard"];

    try {
      const proc = Bun.spawn(cmd, {
        stdin: new TextEncoder().encode(text),
        stdout: "ignore",
        stderr: "ignore",
      });
      return await proc.exited === 0;
    } catch {
      return false;
    }
  }

  private async runInteractiveBrowser(
    chats: ChatInfo[],
    options: ListCommandOptions,
    context: CliCommandContext,
  ): Promise<void> {
    while (true) {
      const result = await browser({
        chats,
        initialSort: options.sort,
      });
      if (result.kind === "quit") return;
      const actionResult = await this.showActionMenu(result.chat);
      if (actionResult === "quit") return;
      if (actionResult === "back") continue;
      await this.executeAction(actionResult, result.chat, context);
      if (actionResult === "delete") {
        const idx = chats.findIndex((c) => c.id === result.chat.id);
        if (idx >= 0) chats.splice(idx, 1);
      }
    }
  }

  private async showActionMenu(chat: ChatInfo): Promise<BrowserAction> {
    const choice = await select<BrowserAction>({
      message: `Selected: ${chat.id} — "${chat.title}"`,
      choices: [
        { value: "view", label: "View full conversation" },
        { value: "export-markdown", label: "Export to Markdown" },
        { value: "export-json", label: "Export to JSON" },
        { value: "copy-id", label: "Copy conversation ID" },
        { value: "continue", label: "Continue conversation" },
        {
          value: "delete",
          label: "Delete conversation",
          description: "No confirmation",
        },
        { value: "back", label: "Back to list" },
        { value: "quit", label: "Quit" },
      ],
    });
    return choice;
  }

  private async executeAction(
    action: BrowserAction,
    chat: ChatInfo,
    context: CliCommandContext,
  ): Promise<void> {
    if (action === "back" || action === "quit") {
      return;
    }
    if (action === "copy-id") {
      const success = await this.copyToClipboard(chat.id);
      if (success) {
        console.log(chalk.cyan(`Copied: ${chat.id}`));
      } else {
        console.log(chalk.yellow(`Could not copy to clipboard: ${chat.id}`));
      }
      return;
    }
    const { CommandRegistry } = await import("../command-registry.ts");
    const registry = new CommandRegistry();
    registry.registerAllCommands();
    if (action === "view") {
      const fetch = registry.getHandler("fetch");
      if (fetch) await fetch.execute([chat.id, "--format", "text"], context);
    } else if (action === "export-markdown") {
      const outPath = await this.promptExportPath(chat.id, "md");
      const exportCmd = registry.getHandler("export");
      if (exportCmd) await exportCmd.execute([chat.id, "--format", "markdown", "--out", outPath], context);
    } else if (action === "export-json") {
      const outPath = await this.promptExportPath(chat.id, "json");
      const exportCmd = registry.getHandler("export");
      if (exportCmd) await exportCmd.execute([chat.id, "--format", "json", "--out", outPath], context);
    } else if (action === "continue") {
      const continueCmd = registry.getHandler("continue");
      if (continueCmd) await continueCmd.execute([chat.id], context);
    } else if (action === "delete") {
      const deleteCmd = registry.getHandler("delete");
      if (deleteCmd) await deleteCmd.execute([chat.id, "--force"], context);
    }
  }

  private async promptExportPath(chatId: string, ext: "md" | "json"): Promise<string> {
    const date = new Date().toISOString().slice(0, 10);
    const defaultPath = `gemini-chat-${chatId}-${date}.${ext}`;
    const entered = await text({
      message: "Output path:",
      default: defaultPath,
    });
    return entered.trim() === "" ? defaultPath : entered.trim();
  }

  private parseArgs(args: string[]): ListCommandOptions {
    const options = parseCommandArgs(args, LIST_FLAGS) as unknown as ListCommandOptions;

    if (options.interactive && !options.profile) {
      options.allProfiles = true;
    }

    if (
      options.interactive &&
      (options.format !== DEFAULT_OPTIONS.format || options.out !== DEFAULT_OPTIONS.out)
    ) {
      throw new GemitermError("Cannot use --interactive with --format or --out.");
    }

    return options;
  }

  private showUsage(): void {
    console.log(renderUsage(LIST_USAGE));
  }
}
