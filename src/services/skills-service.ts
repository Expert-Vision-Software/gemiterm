import { Logger } from "../infrastructure/logger.ts";
import { SkillsCliDriver, SkillsCliDriverOptions, SkillsCliError } from "./skills-cli-driver.ts";

export class SkillsInstallError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "SkillsInstallError";
  }
}

export interface InstallSkillsServiceOptions {
  logger?: Logger;
  driver?: SkillsCliDriver;
  repo?: string;
  skills?: string[];
}

export class InstallSkillsService {
  private readonly logger: Logger;
  private readonly driver: SkillsCliDriver;
  private readonly repo: string;
  private readonly skills: string[];

  constructor(opts: InstallSkillsServiceOptions = {}) {
    this.logger = opts.logger ?? new Logger("install-skills-service");
    this.repo = opts.repo ?? "expert-vision-software/opencode-gemiterm-skills";
    this.skills = opts.skills ?? ["gemiterm", "debate-with-gemini"];
    this.driver = opts.driver ?? new SkillsCliDriver({ logger: this.logger });
  }

  async install(): Promise<string> {
    this.logger.info(`Installing skills from ${this.repo}: ${this.skills.join(", ")}`);
    const args = ["add", this.repo];
    for (const skill of this.skills) {
      args.push("--skill", skill);
    }

    try {
      const output = await this.driver.run(args);
      this.logger.info(`Skills installed successfully: ${output}`);
      return output;
    } catch (error) {
      if (error instanceof SkillsCliError) {
        throw new SkillsInstallError(error.message, error);
      }
      throw new SkillsInstallError(
        `Failed to install skills: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
