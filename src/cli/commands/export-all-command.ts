import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { parseCommandArgs, renderUsage, type ArgFlagSpec, type UsageSpec } from "../utils/command-args.ts";
import { render } from "../utils/chat-output.ts";

interface ExportAllCommandOptions {
  help: boolean;
  outDir: string;
  since: string;
  includeMetadata: boolean;
  allProfiles: boolean;
}

const EXPORT_ALL_FLAGS: readonly ArgFlagSpec[] = [
  { key: "outDir", long: "--out-dir", short: "-o", type: "string", description: "Output directory (default: ./exports)", helpLabel: "--out-dir, -o <dir>", default: "./exports" },
  { key: "since", long: "--since", type: "string", description: "Only export chats from this date onwards", helpLabel: "--since <date>", default: "" },
  { key: "includeMetadata", long: "--include-metadata", type: "boolean", description: "Include metadata headers in exports", helpLabel: "--include-metadata", default: false },
  { key: "allProfiles", long: "--all-profiles", short: "-a", type: "boolean", description: "Export conversations from all profiles", helpLabel: "--all-profiles, -a", default: false },
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "--help, -h", default: false },
];

const EXPORT_ALL_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm export-all [options]",
  flags: EXPORT_ALL_FLAGS,
};

export class ExportAllCommand implements CliCommand {
  readonly name = "export-all";
  readonly description = "Export all conversations to files";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("export-all-command");
    const options = this.parseArgs(args);

    if (options.help) {
      this.showUsage();
      return;
    }

    logger.debug("Listing chats for export-all");

    try {
      const chats = options.allProfiles
        ? []
        : await (await context.getGeminiClient()).listChats({});

      await render(
        {
          kind: "batch-export",
          chats,
          outDir: options.outDir,
          since: options.since || undefined,
          allProfiles: options.allProfiles,
          includeMetadata: options.includeMetadata,
        },
        { format: "markdown" },
        context.exportStrategies,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  }

  private parseArgs(args: string[]): ExportAllCommandOptions {
    return parseCommandArgs(args, EXPORT_ALL_FLAGS) as unknown as ExportAllCommandOptions;
  }

  private showUsage(): void {
    console.log(renderUsage(EXPORT_ALL_USAGE));
  }
}
