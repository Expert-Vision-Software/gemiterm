import chalk from "chalk";

export type ArgFlagType = "boolean" | "string" | "integer" | "enum";

export interface ArgFlagSpec {
  key: string;
  long: string;
  short?: string;
  type: ArgFlagType;
  description: string;
  helpLabel: string;
  default?: unknown;
  enum?: readonly string[];
  required?: boolean;
  valueName?: string;
}

export interface UsageArgument {
  name: string;
  description: string;
}

export interface UsageSpec {
  usageLine: string;
  description?: string;
  arguments?: readonly UsageArgument[];
  flags: readonly ArgFlagSpec[];
  footer?: readonly string[];
}

export function parseCommandArgs(
  args: string[],
  flags: readonly ArgFlagSpec[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const byToken = new Map<string, ArgFlagSpec>();

  for (const flag of flags) {
    result[flag.key] = flag.default;
    byToken.set(flag.long, flag);
    if (flag.short) byToken.set(flag.short, flag);
  }

  for (let i = 0; i < args.length; i++) {
    const flag = byToken.get(args[i]);
    if (!flag) continue;

    switch (flag.type) {
      case "boolean":
        result[flag.key] = true;
        break;

      case "string": {
        const next = args[i + 1];
        if (flag.required && (next === undefined || next.startsWith("-"))) {
          failMissingValue(flag);
        }
        result[flag.key] = next ?? (flag.default ?? "");
        if (next !== undefined) i++;
        break;
      }

      case "integer": {
        const next = args[i + 1];
        if (flag.required && (next === undefined || next.startsWith("-"))) {
          failMissingValue(flag);
        }
        result[flag.key] = parseInt(next ?? "", 10) || (flag.default ?? 0);
        if (next !== undefined) i++;
        break;
      }

      case "enum": {
        const next = args[i + 1];
        if (flag.required && (next === undefined || next.startsWith("-"))) {
          failMissingValue(flag);
        }
        const value = next ?? "";
        result[flag.key] = flag.enum?.includes(value) ? value : flag.default;
        if (next !== undefined) i++;
        break;
      }
    }
  }

  return result;
}

function failMissingValue(flag: ArgFlagSpec): never {
  console.error(chalk.red(`Error: ${flag.long} requires a ${flag.valueName ?? "value"}`));
  process.exit(1);
}

export function renderUsage(spec: UsageSpec): string {
  const lines: string[] = [];

  lines.push(chalk.bold(spec.usageLine));
  lines.push("");

  if (spec.description) {
    lines.push(spec.description);
    lines.push("");
  }

  if (spec.arguments && spec.arguments.length > 0) {
    lines.push(chalk.bold("Arguments:"));
    for (const arg of spec.arguments) {
      lines.push(`  ${chalk.cyan(arg.name.padEnd(20))}${chalk.dim(arg.description)}`);
    }
    lines.push("");
  }

  lines.push(chalk.bold("Options:"));

  const maxLen = Math.max(...spec.flags.map((f) => f.helpLabel.length));
  for (const flag of spec.flags) {
    const padded = flag.helpLabel.padEnd(maxLen + 2);
    lines.push(`  ${chalk.cyan(padded)}${chalk.dim(flag.description)}`);
  }

  if (spec.footer && spec.footer.length > 0) {
    lines.push("");
    for (const line of spec.footer) {
      lines.push(chalk.dim(line));
    }
  }

  return lines.join("\n");
}
