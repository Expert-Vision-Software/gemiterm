import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { fetchChatForRequest } from "../utils/gemini-queries.ts";
import type { Message } from "../../core/types.ts";
import { writeTextFile } from "../../infrastructure/io.ts";
import { resolveProfile } from "../utils/profile-resolution.ts";

interface FetchCommandOptions {
  help: boolean;
  format: "text" | "json";
  out: string;
  profile: string;
}

const DEFAULT_OPTIONS: FetchCommandOptions = {
  help: false,
  format: "text",
  out: "",
  profile: "",
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

    const profileName = await resolveProfile(context, conversationId, options.profile || undefined);

    logger.debug(`Fetching chat: ${conversationId}`);
    const messages = await fetchChatForRequest(context.getGeminiClient, conversationId, profileName ?? undefined);

    if (options.format === "json") {
      this.outputJson(messages, conversationId, options.out);
    } else {
      this.outputText(messages, conversationId, options.out);
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
      throw new Error("Could not invoke list command.");
    }
  }

  private outputJson(messages: Message[], conversationId: string, out: string): void {
    const output = JSON.stringify({ conversationId, messages }, null, 2);
    if (out) {
      this.writeOutput(out, output);
    } else {
      console.log(output);
    }
  }

  private outputText(messages: Message[], conversationId: string, out: string): void {
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
        case "--out":
        case "-o":
          options.out = args[++i] ?? "";
          break;
        case "--profile":
        case "-p":
          options.profile = args[++i] ?? "";
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
      { flag: "--out, -o <path>", desc: "Write output to file" },
      { flag: "--profile, -p <name>", desc: "Profile that owns the conversation (default: auto-discover)" },
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
