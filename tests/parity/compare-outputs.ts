import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { platform, tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  timedOut: boolean;
}

interface ParityResult {
  command: string[];
  python: CliRunResult | null;
  bun: CliRunResult;
  exitCodeMatch: boolean;
  stdoutMatch: boolean;
  stderrMatch: boolean;
  normalizedStdoutMatch: boolean;
  normalizedStderrMatch: boolean;
  discrepancies: string[];
}

interface ParityReport {
  timestamp: string;
  platform: string;
  pythonCli: string;
  bunCli: string;
  bunVersion: string;
  results: ParityResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

function normalizeOutput(output: string): string {
  return output
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/gm, "")
    .trim();
}

function normalizeVersionSpecific(output: string, cliType: "python" | "bun"): string {
  let normalized = output;
  if (cliType === "python") {
    normalized = normalized.replace(/gemiterm\s+v?\d+\.\d+\.\d+/g, "gemiterm vX.Y.Z");
  } else {
    normalized = normalized.replace(/gemiterm\s+v?\d+\.\d+\.\d+/g, "gemiterm vX.Y.Z");
  }
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d+Z/g, "<timestamp>");
  normalized = normalized.replace(/\/tmp\/[^\s/]+/g, "<tmpdir>");
  normalized = normalized.replace(/C:\\[Uu]sers\\[^\s\\]+/g, "<userdir>");
  normalized = normalized.replace(/\/home\/[^\s/]+/g, "<homedir>");
  return normalized;
}

function runPythonCli(
  command: string[],
  configDir: string,
  timeoutMs = 10_000,
): CliRunResult | null {
  const pythonCli = process.env.GEMITERM_PYTHON_CLI || "gemiterm";
  try {
    const fullCmd = `${pythonCli} ${command.join(" ")}`;
    const stdout = execSync(fullCmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      env: { ...process.env, GEMITERM_CONFIG_DIR: configDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      stdout: stdout || "",
      stderr: "",
      exitCode: 0,
      command: fullCmd,
      timedOut: false,
    };
  } catch (error: any) {
    if (error.status === null) {
      return {
        stdout: "",
        stderr: `Command timed out after ${timeoutMs}ms`,
        exitCode: -1,
        command: `${pythonCli} ${command.join(" ")}`,
        timedOut: true,
      };
    }
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
      command: `${pythonCli} ${command.join(" ")}`,
      timedOut: false,
    };
  }
}

function runBunCli(
  command: string[],
  configDir: string,
  timeoutMs = 10_000,
): CliRunResult {
  const bunCli = resolve(import.meta.dir, "..", "..", "src", "cli", "index.ts");
  const fullCmd = `bun ${bunCli} ${command.join(" ")}`;
  try {
    const stdout = execSync(fullCmd, {
      encoding: "utf-8",
      timeout: timeoutMs,
      env: { ...process.env, GEMITERM_CONFIG_DIR: configDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      stdout: stdout || "",
      stderr: "",
      exitCode: 0,
      command: fullCmd,
      timedOut: false,
    };
  } catch (error: any) {
    if (error.status === null) {
      return {
        stdout: "",
        stderr: `Command timed out after ${timeoutMs}ms`,
        exitCode: -1,
        command: fullCmd,
        timedOut: true,
      };
    }
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
      command: fullCmd,
      timedOut: false,
    };
  }
}

function compareResults(command: string[], configDir: string): ParityResult {
  const bunResult = runBunCli(command, configDir);
  const pythonResult = runPythonCli(command, configDir);

  const discrepancies: string[] = [];

  let exitCodeMatch = false;
  if (pythonResult === null) {
    discrepancies.push("Python CLI not available - could not compare");
  } else {
    exitCodeMatch = bunResult.exitCode === pythonResult.exitCode;
    if (!exitCodeMatch) {
      discrepancies.push(
        `Exit code mismatch: Bun=${bunResult.exitCode}, Python=${pythonResult.exitCode}`,
      );
    }

    const bunNorm = normalizeVersionSpecific(normalizeOutput(bunResult.stdout), "bun");
    const pyNorm = normalizeVersionSpecific(normalizeOutput(pythonResult.stdout), "python");
    if (bunNorm !== pyNorm) {
      discrepancies.push("stdout content differs (after normalization)");
    }

    const bunErrNorm = normalizeVersionSpecific(normalizeOutput(bunResult.stderr), "bun");
    const pyErrNorm = normalizeVersionSpecific(normalizeOutput(pythonResult.stderr), "python");
    if (bunErrNorm !== pyErrNorm) {
      discrepancies.push("stderr content differs (after normalization)");
    }
  }

  const bunNorm = normalizeOutput(bunResult.stdout);
  const pyNorm = pythonResult
    ? normalizeVersionSpecific(normalizeOutput(pythonResult.stdout), "python")
    : "";
  const bunErrNorm = normalizeOutput(bunResult.stderr);
  const pyErrNorm = pythonResult
    ? normalizeVersionSpecific(normalizeOutput(pythonResult.stderr), "python")
    : "";

  return {
    command,
    python: pythonResult,
    bun: bunResult,
    exitCodeMatch: pythonResult === null ? true : exitCodeMatch,
    stdoutMatch: pythonResult === null ? true : bunResult.stdout === pythonResult.stdout,
    stderrMatch: pythonResult === null ? true : bunResult.stderr === pythonResult.stderr,
    normalizedStdoutMatch: pythonResult === null ? true : bunNorm === pyNorm,
    normalizedStderrMatch: pythonResult === null ? true : bunErrNorm === pyErrNorm,
    discrepancies,
  };
}

function generateReport(results: ParityResult[]): ParityReport {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const result of results) {
    if (result.python === null) {
      summary.skipped++;
    } else if (result.discrepancies.length === 0) {
      summary.passed++;
    } else {
      summary.failed++;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    platform: `${platform()}-${process.arch}`,
    pythonCli: process.env.GEMITERM_PYTHON_CLI || "gemiterm",
    bunCli: "bun run src/cli/index.ts",
    bunVersion: Bun.version,
    results,
    summary,
  };
}

function formatReport(report: ParityReport): string {
  const lines: string[] = [];
  lines.push("=".repeat(70));
  lines.push("PARITY REPORT: Python gemiterm vs Bun gemiterm");
  lines.push("=".repeat(70));
  lines.push(`Timestamp : ${report.timestamp}`);
  lines.push(`Platform  : ${report.platform}`);
  lines.push(`Python CLI: ${report.pythonCli}`);
  lines.push(`Bun CLI   : ${report.bunCli}`);
  lines.push(`Bun version: ${report.bunVersion}`);
  lines.push("");
  lines.push(`Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped out of ${report.summary.total} total`);
  lines.push("");

  for (const result of report.results) {
    const status =
      result.python === null
        ? "SKIPPED"
        : result.discrepancies.length === 0
          ? "PASS"
          : "FAIL";
    const icon = status === "PASS" ? "OK" : status === "FAIL" ? "!!" : "--";
    lines.push(`[${icon}] ${result.command.join(" ")}`);

    if (status === "FAIL") {
      for (const d of result.discrepancies) {
        lines.push(`    - ${d}`);
      }

      if (result.python) {
        const pyOut = normalizeOutput(result.python.stdout);
        const bunOut = normalizeOutput(result.bun.stdout);
        if (pyOut !== bunOut) {
          lines.push("    Python stdout:");
          lines.push(indentLines(pyOut, 6));
          lines.push("    Bun stdout:");
          lines.push(indentLines(bunOut, 6));
        }

        const pyErr = normalizeOutput(result.python.stderr);
        const bunErr = normalizeOutput(result.bun.stderr);
        if (pyErr !== bunErr) {
          lines.push("    Python stderr:");
          lines.push(indentLines(pyErr, 6));
          lines.push("    Bun stderr:");
          lines.push(indentLines(bunErr, 6));
        }
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function indentLines(text: string, indent: number): string {
  const prefix = " ".repeat(indent);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

const HELP_COMMANDS: string[][] = [
  ["--help"],
  ["--version"],
  ["status", "--help"],
  ["list", "--help"],
  ["fetch", "--help"],
  ["export", "--help"],
  ["export-all", "--help"],
  ["delete", "--help"],
  ["new", "--help"],
  ["continue", "--help"],
  ["profile", "--help"],
  ["auth", "--help"],
];

const STATUS_COMMANDS: string[][] = [
  ["status"],
];

const LIST_COMMANDS: string[][] = [
  ["list"],
  ["list", "--limit", "5"],
  ["list", "--format", "json"],
];

const DEFAULT_TEST_COMMANDS: string[][] = [
  ...HELP_COMMANDS,
  ...STATUS_COMMANDS,
  ...LIST_COMMANDS,
];

function createTestConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "gemiterm-parity-"));
}

export async function runParityComparison(
  commands?: string[][],
  configDir?: string,
): Promise<ParityReport> {
  const useConfigDir = configDir || createTestConfigDir();
  const cmds = commands || DEFAULT_TEST_COMMANDS;
  const results: ParityResult[] = [];

  for (const cmd of cmds) {
    const result = compareResults(cmd, useConfigDir);
    results.push(result);
  }

  return generateReport(results);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let commands = DEFAULT_TEST_COMMANDS;
  let configDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--commands" && args[i + 1]) {
      commands = args[i + 1].split(",").map((c) => c.split(" "));
      i++;
    } else if (args[i] === "--config-dir" && args[i + 1]) {
      configDir = args[i + 1];
      i++;
    }
  }

  const report = await runParityComparison(commands, configDir);
  console.log(formatReport(report));

  process.exit(report.summary.failed > 0 ? 1 : 0);
}
