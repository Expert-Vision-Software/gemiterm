import { Logger } from "../infrastructure/logger.ts";

export class SkillsCliError extends Error {
  constructor(command: string, exitCode: number, stderr: string) {
    super(`skills '${command}' exited with code ${exitCode}: ${stderr}`);
    this.name = "SkillsCliError";
  }
}

export interface SkillsRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SkillsRunner {
  run(args: string[]): Promise<SkillsRunnerResult>;
}

export class BunSkillsRunner implements SkillsRunner {
  async run(args: string[]): Promise<SkillsRunnerResult> {
    const proc = Bun.spawn(["npx", "skills", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode: exitCode ?? -1, stdout: stdout.trim(), stderr: stderr.trim() };
  }
}

export interface SkillsCliDriverOptions {
  logger?: Logger;
  runner?: SkillsRunner;
}

export class SkillsCliDriver {
  private readonly logger: Logger;
  private readonly runner: SkillsRunner;

  constructor(opts: SkillsCliDriverOptions = {}) {
    this.logger = opts.logger ?? new Logger("skills-cli-driver");
    this.runner = opts.runner ?? new BunSkillsRunner();
  }

  async run(args: string[]): Promise<string> {
    this.logger.debug(`Running: npx skills ${args.join(" ")}`);
    const result = await this.runner.run(args);
    if (result.exitCode !== 0) {
      throw new SkillsCliError(args.join(" "), result.exitCode, result.stderr);
    }
    return result.stdout;
  }
}
