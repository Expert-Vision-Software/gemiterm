import chalk from "chalk";

const COMMANDS = [
  { name: "login", description: "Authenticate with Google Gemini" },
  { name: "logout", description: "Remove stored authentication" },
  { name: "status", description: "Show current authentication status" },
  { name: "chat", description: "Start an interactive chat session" },
  { name: "list", description: "List conversations" },
  { name: "send", description: "Send a message to a conversation" },
  { name: "history", description: "View conversation history" },
  { name: "profile", description: "Manage authentication profiles" },
];

const GLOBAL_OPTIONS = [
  { flag: "--version, -v", description: "Show version number" },
  { flag: "--help, -h", description: "Show this help message" },
  { flag: "--verbose", description: "Enable verbose output" },
];

export function showHelp(): void {
  const lines: string[] = [];

  lines.push(chalk.bold.white("GemiTerm") + chalk.dim(" - Google Gemini Terminal Client"));
  lines.push("");
  lines.push(chalk.bold("Usage:"));
  lines.push("  gemiterm [command] [options]");
  lines.push("");
  lines.push(chalk.bold("Commands:"));

  const maxCmdLen = Math.max(...COMMANDS.map((c) => c.name.length));
  for (const cmd of COMMANDS) {
    const padded = cmd.name.padEnd(maxCmdLen + 2);
    lines.push(`  ${chalk.green(padded)}${chalk.dim(cmd.description)}`);
  }

  lines.push("");
  lines.push(chalk.bold("Global Options:"));

  const maxOptLen = Math.max(...GLOBAL_OPTIONS.map((o) => o.flag.length));
  for (const opt of GLOBAL_OPTIONS) {
    const padded = opt.flag.padEnd(maxOptLen + 2);
    lines.push(`  ${chalk.cyan(padded)}${chalk.dim(opt.description)}`);
  }

  lines.push("");
  lines.push(chalk.dim("Run 'gemiterm <command> --help' for more information about a command."));

  console.log(lines.join("\n"));
}

export { COMMANDS };
