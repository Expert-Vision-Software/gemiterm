import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AuthCommand } from "../../src/cli/commands/auth-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import type { ProfileLifecycle } from "../../src/services/profile-lifecycle.ts";

describe("AuthCommand", () => {
  let command: AuthCommand;
  let context: CliCommandContext;
  let manageProfiles: ReturnType<typeof mock>;
  let lifecycle: ProfileLifecycle;

  beforeEach(() => {
    command = new AuthCommand();
    manageProfiles = mock(async () => undefined);
    lifecycle = { manageProfiles } as unknown as ProfileLifecycle;
    context = {
      verbose: false,
      profileLifecycle: lifecycle,
    } as unknown as CliCommandContext;
  });

  afterEach(() => {
    mock.restore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("auth");
    expect(command.description).toBe("Authenticate with Google Gemini");
  });

  describe("execute", () => {
    test("dispatches the auth action when no args are given", async () => {
      await command.execute([], context);
      expect(manageProfiles).toHaveBeenCalledWith("auth", {});
    });

    test("dispatches the list action for --list", async () => {
      await command.execute(["--list"], context);
      expect(manageProfiles).toHaveBeenCalledWith("list", {});
    });

    test("dispatches the list action for -l", async () => {
      await command.execute(["-l"], context);
      expect(manageProfiles).toHaveBeenCalledWith("list", {});
    });

    test("dispatches the create action for --add", async () => {
      await command.execute(["--add", "new-profile"], context);
      expect(manageProfiles).toHaveBeenCalledWith("create", { name: "new-profile" });
    });

    test("dispatches the delete action for --delete without --yes", async () => {
      await command.execute(["--delete", "p1"], context);
      expect(manageProfiles).toHaveBeenCalledWith("delete", {
        name: "p1",
        skipConfirm: false,
      });
    });

    test("dispatches the delete action with skipConfirm for --delete --yes", async () => {
      await command.execute(["--delete", "p1", "--yes"], context);
      expect(manageProfiles).toHaveBeenCalledWith("delete", {
        name: "p1",
        skipConfirm: true,
      });
    });

    test("dispatches the rename action for --rename", async () => {
      await command.execute(["--rename", "p1", "p1-renamed"], context);
      expect(manageProfiles).toHaveBeenCalledWith("rename", {
        oldName: "p1",
        newName: "p1-renamed",
      });
    });

    test("dispatches the set-default action for --default", async () => {
      await command.execute(["--default", "p2"], context);
      expect(manageProfiles).toHaveBeenCalledWith("set-default", { name: "p2" });
    });

    test("dispatches the auth action with renewProfile for --renew", async () => {
      await command.execute(["--renew", "p1"], context);
      expect(manageProfiles).toHaveBeenCalledWith("auth", { renewProfile: "p1" });
    });

    test("dispatches the auth action with renewProfile for -e", async () => {
      await command.execute(["-e", "p1"], context);
      expect(manageProfiles).toHaveBeenCalledWith("auth", { renewProfile: "p1" });
    });

    test("dispatches the auth action with profileName for a positional arg", async () => {
      await command.execute(["p1"], context);
      expect(manageProfiles).toHaveBeenCalledWith("auth", { profileName: "p1" });
    });
  });

  describe("--help", () => {
    test("shows usage and does not dispatch", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm auth");
      expect(output).toContain("-h, --help");
      expect(manageProfiles).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });
});
