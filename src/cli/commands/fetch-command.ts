import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import type { Mediator, Query } from "../../core/mediator.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  QUERY_TYPES,
  type FetchChatQueryPayload,
  type FetchChatQueryResult,
} from "../../core/query-handlers.ts";
import type { Message } from "../../core/types.ts";

interface FetchCommandOptions {
  help: boolean;
  format: "text" | "json";
  path: string;
}

const DEFAULT_OPTIONS: FetchCommandOptions = {
  help: false,
  format: "text",
  path: "",
};

export class FetchCommand implements CliCommand {
  readonly name = "fetch";
  readonly description = "Fetch and display a conversation";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("fetch-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    let conversationId = this.extractConversationId(args, options);

    if (!conversationId) {
      await this.invokeListCommand(context);
      return;
    }

    const mediator: Mediator = context.mediator;
    const query: FetchChatQueryPayload = { conversationId };

    logger.debug(`Sending fetch-chat query: ${JSON.stringify(query)}`);
    const result = await mediator.send<FetchChatQueryResult>({
      type: QUERY_TYPES.FETCH_CHAT,
      payload: query,
    } as Query<FetchChatQueryPayload>);

    if (options.format === "json") {
      this.outputJson(result.messages, conversationId, options.path);
    } else {
      this.outputText(result.messages, conversationId, options.path);
    }
  }

  private extractConversationId(args: string[], options: FetchCommandOptions): string | null {
    for (const arg of args) {
      if (arg.startsWith("--") || arg.startsWith("-")) continue;
      return arg;
    }
    return null;
  }

  private async invokeListCommand(context: CliCommandContext): Promise<void> {
    const { CommandRegistry } = await import("../command-registry.ts");
    const registry = new CommandRegistry();
    registry.registerAllCommands();

    const listHandler = registry.getHandler("list");
    if (listHandler) {
      console.log(chalk.dim("No conversation ID specified. Listing conversations:\n"));
      await listHandler.execute([], context);
    } else {
      console.error("Could not invoke list command.");
      process.exit(1);
    }
  }

  private outputJson(messages: Message[], conversationId: string, path: string): void {
    const output = JSON.stringify({ conversationId, messages }, null, 2);
    if (path) {
      this.writeOutput(path, output);
    } else {
      console.log(output);
    }
  }

  private outputText(messages: Message[], conversationId: string, path: string): void {
    const lines: string[] = [];

    lines.push(chalk.bold(`Conversation: ${chalk.cyan(conversationId)}`));
    lines.push("");

    if (messages.length === 0) {
      lines.push(chalk.dim("No messages found."));
    } else {
      for (const msg of messages) {
        const label =
          msg.role === "user" ? chalk.green.bold("User:") : chalk.blue.bold("Model:");
        lines.push(label);
        lines.push(msg.content);
        lines.push("");
      }
    }

    const output = lines.join("\n");
    if (path) {
      this.writeOutput(path, output);
    } else {
      console.log(output);
    }
  }

  private writeOutput(path: string, content: string): void {
    const resolved = resolve(path);
    const dir = dirname(resolved);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolved, content, "utf-8");
    console.log(chalk.dim(`Output written to: ${resolved}`));
  }

  private parseArgs(args: string[]): FetchCommandOptions {
    const options = { ...DEFAULT_OPTIONS };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case "--help":
        case "-h":
          options.help = true;
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

  private parseFormat(value: string | undefined): "text" | "json" {
    if (value === "text" || value === "json") return value;
    return DEFAULT_OPTIONS.format;
  }

  private showUsage(): void {
    console.log(chalk.bold("Usage: gemiterm fetch [conversation_id] [options]"));
    console.log("");
    console.log(chalk.bold("Arguments:"));
    console.log(`  ${chalk.cyan("conversation_id".padEnd(20))}${chalk.dim("ID of the conversation to fetch (optional)")}`);
    console.log("");
    console.log(chalk.bold("Options:"));

    const flags = [
      { flag: "--format, -f <fmt>", desc: "Output format: text, json (default: text)" },
      { flag: "--path, -p <path>", desc: "Write output to file" },
      { flag: "--help, -h", desc: "Show this help message" },
    ];

    const maxLen = Math.max(...flags.map((f) => f.flag.length));
    for (const f of flags) {
      const padded = f.flag.padEnd(maxLen + 2);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(f.desc)}`);
    }

    console.log("");
    console.log(chalk.dim("If no conversation_id is provided, the list command will be invoked."));
  }
}
