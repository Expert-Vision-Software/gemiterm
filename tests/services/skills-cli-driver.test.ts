import { describe, test, expect } from "bun:test";
import { SkillsCliError, type SkillsRunner } from "../../src/services/skills-cli-driver.ts";
import { SkillsCliDriver } from "../../src/services/skills-cli-driver.ts";

describe("SkillsCliError", () => {
  test("has correct name and message", () => {
    const error = new SkillsCliError("add repo", 1, "not found");
    expect(error.name).toBe("SkillsCliError");
    expect(error.message).toContain("add repo");
    expect(error.message).toContain("1");
    expect(error.message).toContain("not found");
  });
});

describe("SkillsCliDriver", () => {
  test("returns stdout on success", async () => {
    const mockRunner: SkillsRunner = {
      async run() {
        return { exitCode: 0, stdout: "installed", stderr: "" };
      },
    };

    const driver = new SkillsCliDriver({ runner: mockRunner });
    const result = await driver.run(["add", "some/repo", "--skill", "foo"]);
    expect(result).toBe("installed");
  });

  test("throws SkillsCliError on non-zero exit", async () => {
    const mockRunner: SkillsRunner = {
      async run() {
        return { exitCode: 1, stdout: "", stderr: "something went wrong" };
      },
    };

    const driver = new SkillsCliDriver({ runner: mockRunner });
    await expect(driver.run(["add", "some/repo"])).rejects.toBeInstanceOf(SkillsCliError);
  });
});
