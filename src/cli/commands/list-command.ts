import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { listChatsForRequest, type ListChatsRequest } from "../utils/gemini-queries.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";
import type { ChatInfo } from "../../core/types.ts";
import { GemitermError } from "../../core/errors.ts";
import { browser, confirm, select, text, CancellationError, NonInteractiveError, type BrowserAction } from "../utils/prompts.ts";
import type { SessionProbeResult } from "../../auth/cookie-session.ts";
import { invokeCommand } from "../utils/command-invoker.ts";
import { render, sortChats, filterChatsByDate } from "../utils/chat-output.ts";

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

    if (chats.length === 0) {
      chats = await this.resolvePhantomEmptyResult(chats, request, context, logger);
    }

    chats = filterChatsByDate(chats, {
      after: options.after || undefined,
      before: options.before || undefined,
    });
    chats = sortChats(chats, options.sort);

    if (hasLimit) {
      chats = chats.slice(options.offset, options.offset + options.limit);
    } else if (options.offset > 0) {
      chats = chats.slice(options.offset);
    }

    const includeProfileColumn =
      options.allProfiles || Boolean(options.profile) || (await context.listProfiles()).length > 1;

    await render(
      { kind: "chat-list", chats, includeProfileColumn },
      { format: options.format, out: options.out || undefined },
    );
  }

  private async resolvePhantomEmptyResult(
    chats: ChatInfo[],
    request: ListChatsRequest,
    context: CliCommandContext,
    logger: Logger,
  ): Promise<ChatInfo[]> {
    let profileName = request.profile;
    if (!profileName && !request.allProfiles) {
      const profiles = await context.listProfiles();
      if (profiles.length === 1) profileName = profiles[0];
    }
    if (!profileName) return chats;

    // Rotation-await stage (openspec/changes/await-detached-rotation-on-empty-list):
    // an empty result on a stale-armed jar usually means the detached rotation
    // is still in flight — await it (bounded) before reaching for the heavier
    // probe/recovery flow. stderr-only: stdout bytes stay pinned.
    if (context.cookieSession.rotationInFlight(profileName)) {
      console.error(chalk.dim("Session refresh in progress — waiting for it to finish…"));
      const refreshed = await context.cookieSession.waitForRotation(profileName).catch(() => null);
      if (refreshed) {
        const retried = await listChatsForRequest(context.getGeminiClient, context.listProfiles, request);
        if (retried.length > 0) return retried;
      } else if (context.cookieSession.rotationInFlight(profileName)) {
        console.error(chalk.yellow(
          `Session refresh still in progress for profile '${profileName}' — wait a few seconds and re-run 'gemiterm list'.`,
        ));
      }
    }

    let state: SessionProbeResult["state"];
    try {
      state = await context.cookieSession.probe(profileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Session classification failed for profile '${profileName}': ${message}`);
      return chats;
    }

    if (state === "live") return chats;

    let accepted: boolean;
    try {
      accepted = await confirm({
        message: `Profile '${profileName}' session is ${state} (no conversations visible). Attempt session recovery now?`,
      });
    } catch (error) {
      // The facade owns the TTY gate: non-interactive runs fall through to the
      // stderr diagnostic; a user cancel is a decline. Stdout stays untouched either way.
      if (error instanceof NonInteractiveError) {
        console.error(chalk.yellow(
          `Profile '${profileName}' session is ${state} — the server reports no conversations for this profile. Run 'gemiterm auth' to re-authenticate.`,
        ));
        return chats;
      }
      if (error instanceof CancellationError) return chats;
      throw error;
    }
    if (!accepted) return chats;

    await context.cookieSession.recover(profileName);

    const retried = await listChatsForRequest(context.getGeminiClient, context.listProfiles, request);
    if (retried.length > 0) return retried;

    console.error(chalk.yellow(
      `Recovery finished, but profile '${profileName}' still reports no conversations (session was ${state}). Run 'gemiterm auth' to re-authenticate if this persists.`,
    ));
    return retried;
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
        windowsHide: true,
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
    if (action === "view") {
      await invokeCommand("fetch", [chat.id, "--format", "text"], context);
    } else if (action === "export-markdown") {
      const outPath = await this.promptExportPath(chat.id, "md");
      await invokeCommand("export", [chat.id, "--format", "markdown", "--out", outPath], context);
    } else if (action === "export-json") {
      const outPath = await this.promptExportPath(chat.id, "json");
      await invokeCommand("export", [chat.id, "--format", "json", "--out", outPath], context);
    } else if (action === "continue") {
      await invokeCommand("continue", [chat.id], context);
    } else if (action === "delete") {
      await invokeCommand("delete", [chat.id, "--force"], context);
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
