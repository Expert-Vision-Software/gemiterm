import { describe, test, expect, spyOn } from "bun:test";
import { InstallSkillsService, SkillsInstallError } from "../../src/services/skills-service.ts";
import { SkillsCliDriver, SkillsCliError, type SkillsRunner } from "../../src/services/skills-cli-driver.ts";

describe("SkillsInstallError", () => {
  test("has correct name and message", () => {
    const error = new SkillsInstallError("test error");
    expect(error.name).toBe("SkillsInstallError");
    expect(error.message).toBe("test error");
    expect(error.cause).toBeUndefined();
  });

  test("preserves cause", () => {
    const cause = new Error("original");
    const error = new SkillsInstallError("wrapper", cause);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("wrapper");
  });
});

describe("InstallSkillsService", () => {
  test("calls driver with correct default args", async () => {
    let capturedArgs: string[] = [];
    const mockRunner: SkillsRunner = {
      async run(args) {
        capturedArgs = args;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    };

    const driver = new SkillsCliDriver({ runner: mockRunner });
    const service = new InstallSkillsService({ driver });
    const output = await service.install();

    expect(output).toBe("done");
    expect(capturedArgs).toEqual([
      "add",
      "expert-vision-software/opencode-gemiterm-skills",
      "--skill", "gemiterm",
      "--skill", "debate-with-gemini",
    ]);
  });

  test("uses custom repo and skills when provided", async () => {
    let capturedArgs: string[] = [];
    const mockRunner: SkillsRunner = {
      async run(args) {
        capturedArgs = args;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    };

    const driver = new SkillsCliDriver({ runner: mockRunner });
    const service = new InstallSkillsService({
      driver,
      repo: "custom/repo",
      skills: ["skill-a", "skill-b", "skill-c"],
    });
    await service.install();

    expect(capturedArgs).toEqual([
      "add",
      "custom/repo",
      "--skill", "skill-a",
      "--skill", "skill-b",
      "--skill", "skill-c",
    ]);
  });

  test("throws SkillsInstallError on SkillsCliError", async () => {
    const mockRunner: SkillsRunner = {
      async run() {
        return { exitCode: 1, stdout: "", stderr: "install failed" };
      },
    };

    const driver = new SkillsCliDriver({ runner: mockRunner });
    const service = new InstallSkillsService({ driver });

    await expect(service.install()).rejects.toBeInstanceOf(SkillsInstallError);
    const error = await service.install().catch((e) => e) as SkillsInstallError;
    expect(error.cause).toBeInstanceOf(SkillsCliError);
  });

  test("throws SkillsInstallError on generic error", async () => {
    const mockRunner: SkillsRunner = {
      async run() {
        throw new Error("spawn failed");
      },
    };

    const driver = new SkillsCliDriver({ runner: mockRunner });
    const service = new InstallSkillsService({ driver });

    await expect(service.install()).rejects.toBeInstanceOf(SkillsInstallError);
  });
});
