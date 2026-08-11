import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Query } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  QUERY_TYPES,
  type ListChatsQueryPayload,
  type ListChatsQueryResult,
} from "../../core/query-handlers.ts";
import { formatChatList } from "../../infrastructure/formatters.ts";
import type { ChatInfo } from "../../core/types.ts";
import { writeTextFile } from "../../infrastructure/io.ts";
import { AuthenticationError, GemitermError } from "../../core/errors.ts";
import { browser, select, text, confirm, type BrowserAction } from "../utils/prompts.ts";
import { runReauthFlow } from "../utils/reauth.ts";

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

    const mediator: Mediator = context.mediator;
    const hasLimit = options.limit > 0;
    const query: ListChatsQueryPayload = {
      limit: hasLimit ? options.limit : undefined,
      offset: options.offset || undefined,
      search: options.search || undefined,
      allProfiles: options.allProfiles,
      profile: options.profile || undefined,
    };

    logger.debug(`Sending list-chats query: ${JSON.stringify(query)}`);
    const result = await mediator.send<ListChatsQueryResult>({
      type: QUERY_TYPES.LIST_CHATS,
      payload: query,
    } as Query<ListChatsQueryPayload>);

    let chats = result.chats;

    if (result.phantom) {
      try {
        const answer = await confirm({
          message: "Session is active but no conversations were returned. The session may be stale. Re-authenticate?",
          default: true,
        });
        if (answer) {
          if (!context.authService) {
            console.log(chalk.yellow("Re-authentication not available in this context. Run 'gemiterm login' to re-authenticate."));
            return;
          }
          const profileName = options.profile || undefined;
          await runReauthFlow(profileName || "", {
            authService: context.authService,
            confirmPrompt: confirm,
            originalError: new AuthenticationError("Session may be stale — no conversations were found."),
          });
          const retryResult = await mediator.send<ListChatsQueryResult>({
            type: QUERY_TYPES.LIST_CHATS,
            payload: query,
          } as Query<ListChatsQueryPayload>);
          chats = retryResult.chats;
        }
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
      }
    }

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
    const profileArgs = chat.profile ? ["--profile", chat.profile] : [];
    if (action === "view") {
      const fetch = registry.getHandler("fetch");
      if (fetch) await fetch.execute([chat.id, "--format", "text", ...profileArgs], context);
    } else if (action === "export-markdown") {
      const outPath = await this.promptExportPath(chat.id, "md");
      const exportCmd = registry.getHandler("export");
      if (exportCmd) await exportCmd.execute([chat.id, "--format", "markdown", "--out", outPath, ...profileArgs], context);
    } else if (action === "export-json") {
      const outPath = await this.promptExportPath(chat.id, "json");
      const exportCmd = registry.getHandler("export");
      if (exportCmd) await exportCmd.execute([chat.id, "--format", "json", "--out", outPath, ...profileArgs], context);
    } else if (action === "continue") {
      const continueCmd = registry.getHandler("continue");
      if (continueCmd) await continueCmd.execute([chat.id, ...profileArgs], context);
    } else if (action === "delete") {
      const deleteCmd = registry.getHandler("delete");
      if (deleteCmd) await deleteCmd.execute([chat.id, "--force", ...profileArgs], context);
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
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case "--help":
        case "-h":
          options.help = true;
          break;
        case "--limit":
        case "-n":
          options.limit = parseInt(args[++i], 10) || DEFAULT_OPTIONS.limit;
          break;
        case "--offset":
          options.offset = parseInt(args[++i], 10) || 0;
          break;
        case "--all-profiles":
          options.allProfiles = true;
          break;
        case "--profile":
        case "-p":
          options.profile = args[++i] ?? "";
          break;
        case "--sort":
          options.sort = this.parseSort(args[++i]);
          break;
        case "--search":
        case "-s":
          options.search = args[++i] ?? "";
          break;
        case "--after":
          options.after = args[++i] ?? "";
          break;
        case "--before":
          options.before = args[++i] ?? "";
          break;
        case "--format":
        case "-f":
          options.format = this.parseFormat(args[++i]);
          break;
        case "--out":
        case "-o":
          options.out = args[++i] ?? "";
          break;
        case "--interactive":
        case "-i":
          options.interactive = true;
          break;
      }
    }

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

  private parseSort(value: string | undefined): "recent" | "oldest" | "alpha" {
    if (value === "recent" || value === "oldest" || value === "alpha") return value;
    return DEFAULT_OPTIONS.sort;
  }

  private parseFormat(value: string | undefined): "text" | "json" {
    if (value === "text" || value === "json") return value;
    return DEFAULT_OPTIONS.format;
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm list [options]"));
    console.log("");
    console.log(chalk.bold("Options:"));

    const flags = [
      { flag: "--limit, -n N", desc: "Limit number of results (no limit by default)" },
      { flag: "--offset N", desc: "Skip N results (default: 0)" },
      { flag: "--all-profiles", desc: "Show conversations from all profiles (with Profile column in text output)" },
      { flag: "--profile, -p <name>", desc: "Filter conversations to a specific profile (non-interactive)" },
      { flag: "--sort <mode>", desc: "Sort order: recent, oldest, alpha (default: recent)" },
      { flag: "--search, -s <query>", desc: "Filter by title search" },
      { flag: "--after <date>", desc: "Only show chats after this date" },
      { flag: "--before <date>", desc: "Only show chats before this date" },
      { flag: "--format, -f <fmt>", desc: "Output format: text, json (default: text)" },
      { flag: "--out, -o <path>", desc: "Write output to file" },
      { flag: "--interactive, -i", desc: "Open interactive chat-list browser (TTY only; shows all profiles by default)" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }
  }
}
