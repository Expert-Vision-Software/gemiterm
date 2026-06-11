export const WINDOWS_COMMAND_LINE_ARG_LIMIT = 2048;

export type LongArgGuardResult =
  | { safe: true; arg: string }
  | { safe: false; arg: string; length: number; limit: number; suggestion: string };

export function checkArgLength(arg: string): LongArgGuardResult {
  const length = utf16CodeUnitLength(arg);
  if (length <= WINDOWS_COMMAND_LINE_ARG_LIMIT) {
    return { safe: true, arg };
  }
  return {
    safe: false,
    arg,
    length,
    limit: WINDOWS_COMMAND_LINE_ARG_LIMIT,
    suggestion:
      `Argument is ${length} UTF-16 code units, which exceeds the ${WINDOWS_COMMAND_LINE_ARG_LIMIT} ` +
      `code unit limit imposed by Bun's Windows process spawn path (appendWindowsArgument in ` +
      `Bun's run_command.zig panics with "index out of bounds" when this limit is exceeded). ` +
      `Pipe the message via stdin (e.g. \`echo "..." | gemiterm new\`) or save it to a file and ` +
      `pass it with \`--prompt-file <path>\` (if available for your gemiterm version).`,
  };
}

function utf16CodeUnitLength(s: string): number {
  return s.length;
}
