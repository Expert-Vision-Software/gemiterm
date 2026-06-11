import { Command, CommanderError } from "commander";
import type { CommandRegistry } from "../cli/command-registry.ts";
import { showHelp } from "../cli/commands/help.ts";

export interface ParsedFlags {
  verbose: boolean;
  version: boolean;
  help: boolean;
}

export interface ParsedArgs {
  flags: ParsedFlags;
  subcommand: string | null;
  subcommandArgs: string[];
}

function splitAtFirstNonFlag(argv: string[]): { pre: string[]; post: string[] } {
  const pre: string[] = [];
  const post: string[] = [];
  let found = false;
  for (const arg of argv) {
    if (!found && !arg.startsWith("-")) {
      found = true;
      post.push(arg);
      continue;
    }
    if (found) {
      post.push(arg);
    } else {
      pre.push(arg);
    }
  }
  return { pre, post };
}

export function parseGlobalArgs(argv: string[]): ParsedArgs {
  const { pre, post } = splitAtFirstNonFlag(argv);
  const subcommand = post[0] ?? null;
  const subcommandArgs = post.slice(1);

  const program = new Command();
  program
    .exitOverride()
    .allowUnknownOption(false)
    .allowExcessArguments(true)
    .helpOption(false)
    .configureOutput({ writeErr: () => {} })
    .option("-v, --verbose", "enable verbose output")
    .option("--version", "show version number")
    .option("-h, --help", "show help");

  try {
    program.parse(pre, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      throw new Error("gemiterm: " + error.message);
    }
    throw error;
  }

  const opts = program.opts<{ verbose?: boolean; version?: boolean; help?: boolean }>();
  const flags: ParsedFlags = {
    verbose: Boolean(opts.verbose),
    version: Boolean(opts.version),
    help: Boolean(opts.help),
  };

  return { flags, subcommand, subcommandArgs };
}

export function printVersion(pkgVersion: string): void {
  console.log(`gemiterm v${pkgVersion}`);
}

export function printHelp(registry: CommandRegistry): void {
  showHelp(registry);
}
