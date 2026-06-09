import chalk from "chalk";
import type { CommandRegistry } from "../command-registry.ts";

const GLOBAL_OPTIONS = [
  { flag: "--version", description: "Show version number" },
  { flag: "--help, -h", description: "Show this help message" },
  { flag: "--verbose, -v", description: "Enable verbose output (also: GEMITERM_VERBOSE=true)" },
];

export function showHelp(registry?: CommandRegistry): void {
  const lines: string[] = [];

  lines.push(chalk.bold.white("GemiTerm") + chalk.dim(" - Google Gemini Terminal Client"));
  lines.push("");
  lines.push(chalk.bold("Usage:"));
  lines.push("  gemiterm [command] [options]");
  lines.push("");
  lines.push(chalk.bold("Commands:"));

  if (registry) {
    const names = registry.getRegisteredNames();
    const maxCmdLen = Math.max(...names.map((n) => n.length));
    for (const name of names) {
      const handler = registry.getHandler(name);
      if (handler) {
        const padded = name.padEnd(maxCmdLen + 2);
        lines.push(`  ${chalk.green(padded)}${chalk.dim(handler.description)}`);
      }
    }
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
