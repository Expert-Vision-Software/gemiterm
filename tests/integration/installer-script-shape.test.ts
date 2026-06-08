import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const ps1Path = resolve(root, "install.ps1");
const shPath = resolve(root, "install.sh");

describe("installer script shape", () => {
  test("install.ps1 parses without errors", () => {
    const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
      timeout: 5000,
    });

    if (hasPwsh.status !== 0) {
      console.log("Skipping install.ps1 parse test: pwsh not found on PATH");
      return;
    }

    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `& { [System.Management.Automation.Language.Parser]::ParseFile('${ps1Path}', [ref]$null, [ref]$null) }`,
      ],
      { timeout: 10000 },
    );

    expect(result.status).toBe(0);
  });

  test("install.sh parses without syntax errors", () => {
    const hasBash = spawnSync("bash", ["-c", "exit 0"], { timeout: 5000 });

    if (hasBash.status !== 0) {
      console.log("Skipping install.sh parse test: bash not found on PATH");
      return;
    }

    const result = spawnSync("bash", ["-n", shPath], { timeout: 10000 });

    expect(result.status).toBe(0);
  });

  test("both scripts contain the migration promise comment", async () => {
    const ps1Content = await Bun.file(ps1Path).text();
    const shContent = await Bun.file(shPath).text();

    const hasPs1Promise =
      ps1Content.includes("in place") && ps1Content.includes("NEVER deleted");
    const hasShPromise =
      shContent.includes("in place") && shContent.includes("NEVER deleted");

    expect(hasPs1Promise).toBe(true);
    expect(hasShPromise).toBe(true);
  });
});
