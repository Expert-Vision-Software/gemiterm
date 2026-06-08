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

interface ListCommandOptions {
  help: boolean;
  limit: number;
  offset: number;
  all: boolean;
  allProfiles: boolean;
  sort: "recent" | "oldest" | "alpha";
  search: string;
  after: string;
  before: string;
  format: "text" | "json";
  path: string;
}

const DEFAULT_OPTIONS: ListCommandOptions = {
  help: false,
  limit: 10,
  offset: 0,
  all: false,
  allProfiles: false,
  sort: "recent",
  search: "",
  after: "",
  before: "",
  format: "text",
  path: "",
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
    const query: ListChatsQueryPayload = {
      limit: options.all ? undefined : options.limit,
      offset: options.offset || undefined,
      search: options.search || undefined,
      allProfiles: options.allProfiles,
    };

    logger.debug(`Sending list-chats query: ${JSON.stringify(query)}`);
    const result = await mediator.send<ListChatsQueryResult>({
      type: QUERY_TYPES.LIST_CHATS,
      payload: query,
    } as Query<ListChatsQueryPayload>);

    let chats = result.chats;

    chats = this.applySort(chats, options.sort);
    chats = this.applyDateFilter(chats, options.after, options.before);

    if (!options.all) {
      chats = chats.slice(options.offset, options.offset + options.limit);
    }

    if (options.format === "json") {
      this.outputJson(chats, options.path);
    } else {
      this.outputText(chats, options.path, options.allProfiles);
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

  private outputJson(chats: ChatInfo[], path: string): void {
    const output = JSON.stringify({ chats }, null, 2);
    if (path) {
      this.writeOutput(path, output);
    } else {
      console.log(output);
    }
  }

  private outputText(chats: ChatInfo[], path: string, allProfiles: boolean): void {
    const output = formatChatList(chats, { includeProfileColumn: allProfiles });
    if (path) {
      this.writeOutput(path, output);
    } else {
      console.log(output);
    }
  }

  private writeOutput(path: string, content: string): void {
    writeTextFile(path, content);
    console.log(chalk.dim(`Output written to: ${path}`));
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
        case "--all":
          options.all = true;
          break;
        case "--all-profiles":
          options.allProfiles = true;
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
        case "--path":
        case "-p":
          options.path = args[++i] ?? "";
          break;
      }
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
      { flag: "--limit, -n N", desc: "Number of results (default: 10)" },
      { flag: "--offset N", desc: "Skip N results (default: 0)" },
      { flag: "--all", desc: "Show all conversations (no limit)" },
      { flag: "--all-profiles", desc: "Show conversations from all profiles (with Profile column in text output)" },
      { flag: "--sort <mode>", desc: "Sort order: recent, oldest, alpha (default: recent)" },
      { flag: "--search, -s <query>", desc: "Filter by title search" },
      { flag: "--after <date>", desc: "Only show chats after this date" },
      { flag: "--before <date>", desc: "Only show chats before this date" },
      { flag: "--format, -f <fmt>", desc: "Output format: text, json (default: text)" },
      { flag: "--path, -p <path>", desc: "Write output to file" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }
  }
}
