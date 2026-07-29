const HIGH_INTEGRITY_SID = "S-1-16-12288";

export class ElevationError extends Error {
  constructor() {
    super(
      "Cannot run from an elevated (Administrator) terminal. Chrome for Testing auto-de-elevates " +
        "and its sandbox cannot access the browser executable when launched elevated, which breaks the " +
        "remote-debugging pipe ('Protocol error: Target crashed'). An elevated 'install-browser' also " +
        "corrupts the browser's file permissions. Open a regular (non-Administrator) terminal and retry.",
    );
    this.name = "ElevationError";
  }
}

export function hasHighIntegrity(groupsOutput: string): boolean {
  return groupsOutput.includes(HIGH_INTEGRITY_SID);
}

export function isRunningElevated(): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    const result = Bun.spawnSync(["whoami", "/groups"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    if (result.exitCode !== 0) {
      return false;
    }
    return hasHighIntegrity(result.stdout.toString());
  } catch {
    return false;
  }
}
