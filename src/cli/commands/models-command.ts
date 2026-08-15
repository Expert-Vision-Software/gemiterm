import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";

export class ModelsCommand implements CliCommand {
  readonly name = "models";
  readonly description = "List available Gemini models";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("models-command");
    logger.debug("Executing models command", args);

    if (args.includes("--help") || args.includes("-h")) {
      console.log("Usage: gemiterm models [options]");
      console.log("");
      console.log("List available Gemini models from the static catalog.");
      console.log("");
      console.log("Options:");
      console.log("  -h, --help    Show this help message");
      return;
    }

    const models = await (await context.getGeminiClient()).listModels();

    console.log("Available Gemini models:");
    for (const model of models) {
      console.log(`  ${chalk.cyan(model)}`);
    }
    logger.info(`${models.length} model(s) available`);
  }
}
