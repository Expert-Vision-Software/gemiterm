import { describe, test, expect, afterAll } from "bun:test";
import { spawn, Subprocess } from "bun";
import { resolve } from "node:path";

const CLI_ENTRY = resolve(import.meta.dir, "..", "..", "src", "cli", "index.ts");

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<SpawnResult> {
  const proc: Subprocess = spawn({
    cmd: ["bun", CLI_ENTRY, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GEMITERM_CONFIG_DIR: "" },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode: exitCode ?? -1, stdout, stderr };
}

describe("Smoke Tests", () => {
  test("--help displays usage information and exits 0", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout.toLowerCase()).toContain("gemiterm");
  });

  test("--version prints version string and exits 0", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gemiterm v");
  });

  test("status runs without crashing", async () => {
    const result = await runCli(["status"]);

    expect(result.exitCode).toBeGreaterThanOrEqual(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  }, { timeout: 15_000 });
});
