import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { writeFileSync } from "node:fs";
import { IOError } from "../../src/infrastructure/io.ts";
import {
  BunPlaywrightRunner,
  PlaywrightCliDriver,
  PlaywrightCliError,
  PlaywrightCliUnavailableError,
  isBrowserClosedError,
  type PlaywrightRunner,
  type PlaywrightRunnerResult,
} from "../../src/services/playwright-cli-driver.ts";

function createMockRunner(): PlaywrightRunner & {
  _run: ReturnType<typeof mock>;
  _spawnDetached: ReturnType<typeof mock>;
  _results: PlaywrightRunnerResult[];
} {
  const _run = mock(async (_args: string[]) => ({ exitCode: 0, stdout: "1.0.0", stderr: "" }));
  const _spawnDetached = mock((_args: string[]) => {});
  return {
    _run,
    _spawnDetached,
    _results: [],
    async run(args) {
      const result = await _run(args);
      return result;
    },
    spawnDetached(args) {
      _spawnDetached(args);
    },
  };
}

// Permissive marker stub: open-tests are about argv/runCli, never the real fs.
const permissiveOsMarker = {
  read: async (_dir: string) => null as string | null,
  claim: async (_dir: string, _platform: string) => {},
};

describe("PlaywrightCliDriver", () => {
  let driver: PlaywrightCliDriver;

  beforeEach(() => {
    driver = new PlaywrightCliDriver({ runner: createMockRunner() });
  });

  describe("withSession", () => {
    test("prepends -s flag to args", () => {
      const result = driver.withSession("my-session", ["eval", "() => 1"]);
      expect(result).toEqual(["-s=my-session", "eval", "() => 1"]);
    });

    test("works with empty args", () => {
      const result = driver.withSession("s1", []);
      expect(result).toEqual(["-s=s1"]);
    });
  });

  describe("runCli", () => {
    test("resolves with stdout on successful exit", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 0, stdout: "v1.2.3", stderr: "" });
      const d = new PlaywrightCliDriver({ runner });

      const result = await d.runCli(["--version"]);
      expect(result).toBe("v1.2.3");
      expect(runner._run).toHaveBeenCalledWith(["--version"]);
    });

    test("rejects with PlaywrightCliError on non-zero exit", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "boom" });
      const d = new PlaywrightCliDriver({ runner });

      await expect(d.runCli(["nonexistent-command"])).rejects.toBeInstanceOf(
        PlaywrightCliError,
      );
    });

    test("PlaywrightCliError has correct properties", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "nope" });
      const d = new PlaywrightCliDriver({ runner });

      try {
        await d.runCli(["nonexistent-command"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PlaywrightCliError);
        const e = err as PlaywrightCliError;
        expect(e.name).toBe("PlaywrightCliError");
        expect(e.message).toContain("nonexistent-command");
        expect(e.message).toContain("nope");
      }
    });
  });

  describe("openHeaded", () => {
    test("constructs correct args without session", () => {
      const d = new PlaywrightCliDriver({
        runner: createMockRunner(),
        profileDirResolver: (name) => `/abs/path/to/${name}`,
      });
      const args = d.buildOpenHeadedArgs("https://gemini.google.com/app", "my-profile");
      expect(args).toContain("open");
      expect(args).toContain("https://gemini.google.com/app");
      expect(args).toContain("--browser=chromium");
      expect(args).toContain("--headed");
      expect(args).toContain("--persistent");
      expect(args).toContain("--profile=/abs/path/to/my-profile");
      expect(args).not.toContain(expect.stringContaining("-s="));
    });

    test("includes session flag when provided", () => {
      const args = driver.buildOpenHeadedArgs(
        "https://gemini.google.com/app",
        "my-profile",
        "my-session",
      );
      expect(args[0]).toBe("-s=my-session");
    });

    test("resolves profile to absolute path via injected resolver", () => {
      const resolver = mock((name: string) => `/custom/root/${name}`);
      const d = new PlaywrightCliDriver({ runner: createMockRunner(), profileDirResolver: resolver });
      const args = d.buildOpenHeadedArgs("https://gemini.google.com/app", "p1");
      expect(args).toContain("--profile=/custom/root/p1");
      expect(resolver).toHaveBeenCalledWith("p1");
    });

    test("openHeaded awaits runCli with URL as last arg", async () => {
      const runner = createMockRunner();
      const d = new PlaywrightCliDriver({ runner, profileOsMarker: permissiveOsMarker });
      await d.openHeaded("https://gemini.google.com/app", "p1", "s1");
      expect(runner._run).toHaveBeenCalledTimes(1);
      const args = runner._run.mock.calls[0]![0] as string[];
      expect(args[0]).toBe("-s=s1");
      expect(args).toContain("open");
      expect(args[args.length - 1]).toBe("https://gemini.google.com/app");
    });

    test("openHeaded throws PlaywrightCliError when open command fails", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "open failed" });
      const d = new PlaywrightCliDriver({ runner, profileOsMarker: permissiveOsMarker });
      await expect(d.openHeaded("https://gemini.google.com/app", "p1", "s1")).rejects.toBeInstanceOf(PlaywrightCliError);
    });
  });

  describe("openHeadless", () => {
    test("constructs correct args without session and without --headed", () => {
      const d = new PlaywrightCliDriver({
        runner: createMockRunner(),
        profileDirResolver: (name) => `/abs/path/to/${name}`,
      });
      const args = d.buildOpenHeadlessArgs("https://gemini.google.com/app", "my-profile");
      expect(args).toContain("open");
      expect(args).toContain("https://gemini.google.com/app");
      expect(args).toContain("--browser=chromium");
      expect(args).toContain("--persistent");
      expect(args).toContain("--profile=/abs/path/to/my-profile");
      expect(args).not.toContain("--headed");
      expect(args).not.toContain(expect.stringContaining("-s="));
    });

    test("includes session flag when provided", () => {
      const args = driver.buildOpenHeadlessArgs(
        "https://gemini.google.com/app",
        "my-profile",
        "my-session",
      );
      expect(args[0]).toBe("-s=my-session");
      expect(args).not.toContain("--headed");
    });

    test("headed and headless argv differ only by --headed", () => {
      const d = new PlaywrightCliDriver({
        runner: createMockRunner(),
        profileDirResolver: (name) => `/abs/path/to/${name}`,
      });
      const headed = d.buildOpenHeadedArgs("https://gemini.google.com/app", "p", "s");
      const headless = d.buildOpenHeadlessArgs("https://gemini.google.com/app", "p", "s");
      expect(headed.filter((a) => a !== "--headed")).toEqual(headless);
    });

    test("openHeadless awaits runCli with URL as last arg", async () => {
      const runner = createMockRunner();
      const d = new PlaywrightCliDriver({
        runner,
        profileOsMarker: permissiveOsMarker,
        profileDirResolver: (name) => `/resolved/${name}`,
      });
      await d.openHeadless("https://gemini.google.com/app", "p1", "s1");
      expect(runner._run).toHaveBeenCalledTimes(1);
      const args = runner._run.mock.calls[0]![0] as string[];
      expect(args[0]).toBe("-s=s1");
      expect(args).toContain("open");
      expect(args).toContain("--persistent");
      expect(args).toContain("--profile=/resolved/p1");
      expect(args).not.toContain("--headed");
      expect(args[args.length - 1]).toBe("https://gemini.google.com/app");
    });

    test("openHeadless throws PlaywrightCliError when open command fails", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "open failed" });
      const d = new PlaywrightCliDriver({
        runner,
        profileOsMarker: permissiveOsMarker,
        profileDirResolver: (name) => `/resolved/${name}`,
      });
      await expect(d.openHeadless("https://gemini.google.com/app", "p1", "s1")).rejects.toBeInstanceOf(
        PlaywrightCliError,
      );
    });
  });

  describe("evalJs", () => {
    test("passes expression with session and --raw flag", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        expect(args).toEqual(["-s=test-session", "eval", "() => document.title", "--raw"]);
        return { exitCode: 0, stdout: '"Gemini"', stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      const result = await d.evalJs("test-session", "() => document.title");
      expect(result).toBe('"Gemini"');
    });
  });

  describe("cookieList", () => {
    test("parses valid JSON cookie output", async () => {
      const cookieData = JSON.stringify([
        {
          name: "__Secure-1PSID",
          value: "abc123",
          domain: ".google.com",
          path: "/",
          expires: 1893456000,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "xyz789",
          domain: ".google.com",
          path: "/",
          expires: 1893456000,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);

      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        expect(args).toEqual(["-s=sess1", "cookie-list", "--json"]);
        return { exitCode: 0, stdout: cookieData, stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieList("sess1");
      expect(cookies).toHaveLength(2);
      expect(cookies[0].name).toBe("__Secure-1PSID");
      expect(cookies[0].value).toBe("abc123");
      expect(cookies[0].secure).toBe(true);
      expect(cookies[1].sameSite).toBe("Lax");
    });

    test("returns empty array for invalid JSON", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 0, stdout: "not-json", stderr: "" });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieList("sess1");
      expect(cookies).toEqual([]);
    });

    test("returns empty array for non-array JSON", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 0, stdout: '{"error": "no cookies"}', stderr: "" });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieList("sess1");
      expect(cookies).toEqual([]);
    });

    test("parses envelope { result: '<json-string>' } shape", async () => {
      const innerArray = [
        {
          name: "__Secure-1PSID",
          value: "abc123",
          domain: ".google.com",
          path: "/",
          expires: 1893456000,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "xyz789",
          domain: ".google.com",
          path: "/",
          expires: 1893456000,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ];
      const envelope = JSON.stringify({ result: JSON.stringify(innerArray), raw: "{}" });
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 0, stdout: envelope, stderr: "" });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieList("sess1");
      expect(cookies).toHaveLength(2);
      expect(cookies[0].name).toBe("__Secure-1PSID");
      expect(cookies[0].value).toBe("abc123");
      expect(cookies[0].secure).toBe(true);
      expect(cookies[1].sameSite).toBe("Lax");
    });

    test("returns empty array for envelope with 'No cookies found'", async () => {
      const envelope = JSON.stringify({ result: "No cookies found", raw: "No cookies found" });
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 0, stdout: envelope, stderr: "" });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieList("sess1");
      expect(cookies).toEqual([]);
    });

    test("handles cookies missing fields with defaults", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([{ name: "test-cookie", value: "val" }]),
        stderr: "",
      });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieList("sess1");
      expect(cookies).toHaveLength(1);
      expect(cookies[0].name).toBe("test-cookie");
      expect(cookies[0].domain).toBe("");
      expect(cookies[0].path).toBe("/");
      expect(cookies[0].expires).toBe(-1);
      expect(cookies[0].httpOnly).toBe(false);
      expect(cookies[0].secure).toBe(false);
      expect(cookies[0].sameSite).toBe("None");
    });
  });

  describe("stateSave", () => {
    test("passes correct args", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        expect(args).toEqual(["-s=sess1", "state-save", "/tmp/state.json"]);
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      await d.stateSave("sess1", "/tmp/state.json");
      expect(runner._run).toHaveBeenCalledTimes(1);
    });
  });

  describe("stateLoad", () => {
    test("passes correct args", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        expect(args).toEqual(["-s=sess1", "state-load", "/tmp/state.json"]);
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      await d.stateLoad("sess1", "/tmp/state.json");
      expect(runner._run).toHaveBeenCalledTimes(1);
    });
  });

  describe("cookieListFromState", () => {
    test("invokes state-save with session, parses JSON file, and returns cookies with expires", async () => {
      const storageState = {
        cookies: [
          {
            name: "__Secure-1PSID",
            value: "abc",
            domain: ".google.com",
            path: "/",
            expires: 1893456000,
            httpOnly: true,
            secure: true,
            sameSite: "None",
          },
          {
            name: "__Secure-1PSIDTS",
            value: "xyz",
            domain: ".google.com",
            path: "/",
            expires: 1893456000.5,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins: [],
      };

      let savedPath = "";
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        const stateIdx = args.indexOf("state-save");
        savedPath = args[stateIdx + 1] ?? "";
        writeFileSync(savedPath, JSON.stringify(storageState), "utf-8");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieListFromState("sess1");

      expect(runner._run).toHaveBeenCalledTimes(1);
      const calledArgs = runner._run.mock.calls[0]![0] as string[];
      expect(calledArgs[0]).toBe("-s=sess1");
      expect(calledArgs[1]).toBe("state-save");
      expect(typeof savedPath).toBe("string");
      expect(savedPath.length).toBeGreaterThan(0);

      expect(cookies).toHaveLength(2);
      expect(cookies[0]!.name).toBe("__Secure-1PSID");
      expect(cookies[0]!.expires).toBe(1893456000);
      expect(cookies[1]!.name).toBe("__Secure-1PSIDTS");
      expect(cookies[1]!.expires).toBe(1893456000.5);
    });

    test("returns empty array when storage state has no cookies", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        const stateIdx = args.indexOf("state-save");
        const savedPath = args[stateIdx + 1] ?? "";
        writeFileSync(savedPath, JSON.stringify({ cookies: [], origins: [] }), "utf-8");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      const cookies = await d.cookieListFromState("sess1");
      expect(cookies).toEqual([]);
    });

    test("cleans up the temp file even on read errors", async () => {
      let savedPath = "";
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        savedPath = args[args.indexOf("state-save") + 1] ?? "";
        writeFileSync(savedPath, "{not valid json", "utf-8");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      await expect(d.cookieListFromState("sess1")).rejects.toThrow();
      let stillExists = true;
      try {
        const { existsSync } = await import("node:fs");
        stillExists = existsSync(savedPath);
      } catch {
        stillExists = false;
      }
      expect(stillExists).toBe(false);
    });

    test("propagates state-save failures", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "save failed" });
      const d = new PlaywrightCliDriver({ runner });

      await expect(d.cookieListFromState("sess1")).rejects.toBeInstanceOf(PlaywrightCliError);
    });
  });

  describe("closeSession", () => {
    test("passes correct args", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        expect(args).toEqual(["-s=sess1", "close"]);
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      await d.closeSession("sess1");
      expect(runner._run).toHaveBeenCalledTimes(1);
    });

    test("swallows 'not found' errors (session already closed)", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "session not found",
      });
      const d = new PlaywrightCliDriver({ runner });

      await expect(d.closeSession("sess1")).resolves.toBeUndefined();
    });

test("propagates other PlaywrightCliError failures", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "something else failed",
      });
      const d = new PlaywrightCliDriver({ runner });

      await expect(d.closeSession("sess1")).rejects.toBeInstanceOf(PlaywrightCliError);
    });

    test("swallows 'is not open' errors (browser closed mid-flight)", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "Browser sess1 is not open. Run ...",
      });
      const d = new PlaywrightCliDriver({ runner });

      await expect(d.closeSession("sess1")).resolves.toBeUndefined();
    });
  });

  describe("isBrowserClosedError", () => {
    test("detects 'is not open' stderr", () => {
      expect(isBrowserClosedError(new PlaywrightCliError("cookie-list", 1, "Browser p is not open"))).toBe(true);
    });

    test("detects 'not found' stderr", () => {
      expect(isBrowserClosedError(new PlaywrightCliError("close", 1, "session not found"))).toBe(true);
    });

    test("rejects unrelated PlaywrightCliError stderr", () => {
      expect(isBrowserClosedError(new PlaywrightCliError("cookie-list", 1, "network blip"))).toBe(false);
    });

    test("rejects non-PlaywrightCliError values", () => {
      expect(isBrowserClosedError(new Error("Browser p is not open"))).toBe(false);
      expect(isBrowserClosedError("Browser p is not open")).toBe(false);
      expect(isBrowserClosedError(null)).toBe(false);
    });
  });

  describe("closeAll", () => {
    test("passes correct args without session", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        expect(args).toEqual(["close-all"]);
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      await d.closeAll();
      expect(runner._run).toHaveBeenCalledTimes(1);
    });
  });

  describe("auto-detection", () => {
    test("runCli throws PlaywrightCliUnavailableError when the bunx probe fails", async () => {
      const spy = spyOn(BunPlaywrightRunner.prototype, "run").mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "",
      });
      try {
        const d = new PlaywrightCliDriver();
        await expect(d.runCli(["--version"])).rejects.toBeInstanceOf(
          PlaywrightCliUnavailableError,
        );
      } finally {
        spy.mockRestore();
      }
    });

    test("does not probe when a runner is injected", async () => {
      const runner = createMockRunner();
      const d = new PlaywrightCliDriver({ runner });

      await d.runCli(["--version"]);

      expect(runner._run).toHaveBeenCalledTimes(1);
    });

    test("probes at most once across repeated isAvailable calls", async () => {
      const spy = spyOn(BunPlaywrightRunner.prototype, "run").mockResolvedValue({
        exitCode: 0,
        stdout: "1.0.0",
        stderr: "",
      });
      try {
        const d = new PlaywrightCliDriver();
        await d.isAvailable();
        await d.isAvailable();
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
  describe("cookieListFromState read-failure classification", () => {
    test("missing state file after successful state-save carries the ENOENT cause", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }); // state-save "succeeds", writes nothing
      const d = new PlaywrightCliDriver({ runner });

      try {
        await d.cookieListFromState("sess1");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(IOError);
        expect((err as Error).message).toContain("not found");
        expect((err as IOError).cause).toBeInstanceOf(Error);
        expect(((err as IOError).cause as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });

    test("invalid JSON state file gets a distinct message with .cause", async () => {
      const runner = createMockRunner();
      runner._run.mockImplementationOnce(async (args) => {
        const savedPath = args[args.indexOf("state-save") + 1] ?? "";
        writeFileSync(savedPath, "{not valid json", "utf-8");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const d = new PlaywrightCliDriver({ runner });

      try {
        await d.cookieListFromState("sess1");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(IOError);
        expect((err as Error).message).toContain("not valid JSON");
        expect((err as Error).message).not.toContain("not found");
        expect((err as IOError).cause).toBeInstanceOf(IOError);
      }
    });
  });
});

describe("BunPlaywrightRunner spawn options", () => {
  function fakeSpawnSpy(): ReturnType<typeof spyOn> {
    return spyOn(Bun, "spawn").mockImplementation((() => ({
      stdout: new Response("1.0.0"),
      stderr: new Response(""),
      exited: Promise.resolve(0),
    })) as never);
  }

  test("run spawns with windowsHide so Windows console windows do not flash", async () => {
    const spawnSpy = fakeSpawnSpy();
    try {
      const runner = new BunPlaywrightRunner();

      const result = await runner.run(["--version"]);

      expect(result.exitCode).toBe(0);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const argv = spawnSpy.mock.calls[0][0] as string[];
      expect(argv.slice(0, 2)).toEqual(["bunx", "@playwright/cli"]);
      const opts = spawnSpy.mock.calls[0][1] as { windowsHide?: boolean };
      expect(opts.windowsHide).toBe(true);
    } finally {
      spawnSpy.mockRestore();
    }
  });

  test("spawnDetached spawns with windowsHide so Windows console windows do not flash", () => {
    const spawnSpy = fakeSpawnSpy();
    try {
      const runner = new BunPlaywrightRunner();

      runner.spawnDetached(["open", "--browser=chromium"]);

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const argv = spawnSpy.mock.calls[0][0] as string[];
      expect(argv.slice(0, 2)).toEqual(["bunx", "@playwright/cli"]);
      const opts = spawnSpy.mock.calls[0][1] as { windowsHide?: boolean };
      expect(opts.windowsHide).toBe(true);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
