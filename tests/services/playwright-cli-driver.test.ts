import { describe, test, expect, beforeEach, mock } from "bun:test";
import { writeFileSync } from "node:fs";
import {
  PlaywrightCliDriver,
  PlaywrightCliError,
  PlaywrightCliUnavailableError,
  type PlaywrightRunner,
  type PlaywrightRunnerResult,
  type PlaywrightStrategy,
} from "../../src/services/playwright-cli-driver.ts";

function createMockRunner(strategy: PlaywrightStrategy = "direct"): PlaywrightRunner & {
  _run: ReturnType<typeof mock>;
  _spawnDetached: ReturnType<typeof mock>;
  _results: PlaywrightRunnerResult[];
} {
  const _run = mock(async (_args: string[]) => ({ exitCode: 0, stdout: "1.0.0", stderr: "" }));
  const _spawnDetached = mock((_args: string[]) => {});
  return {
    strategy,
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
      const d = new PlaywrightCliDriver({ runner });
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
      const d = new PlaywrightCliDriver({ runner });
      await expect(d.openHeaded("https://gemini.google.com/app", "p1", "s1")).rejects.toBeInstanceOf(PlaywrightCliError);
    });
  });

  describe("openHeadless", () => {
    test("omits --headed and --persistent flags", () => {
      const d = new PlaywrightCliDriver({
        runner: createMockRunner(),
        profileDirResolver: (name) => `/abs/path/to/${name}`,
      });
      const args = d.buildOpenHeadlessArgs("https://gemini.google.com/app", "p1", "s1");
      expect(args).toContain("open");
      expect(args).toContain("https://gemini.google.com/app");
      expect(args).toContain("--browser=chromium");
      expect(args).toContain("--profile=/abs/path/to/p1");
      expect(args).toContain("-s=s1");
      expect(args).not.toContain("--headed");
      expect(args).not.toContain("--persistent");
    });

    test("omits the session flag when no session is provided", () => {
      const d = new PlaywrightCliDriver({
        runner: createMockRunner(),
        profileDirResolver: (name) => `/abs/path/to/${name}`,
      });
      const args = d.buildOpenHeadlessArgs("https://example.com", "p1");
      expect(args).not.toContain(expect.stringContaining("-s="));
      expect(args).not.toContain("--headed");
      expect(args).not.toContain("--persistent");
      expect(args).toContain("open");
      expect(args).toContain("https://example.com");
    });

    test("uses injected profileDirResolver for --profile path", () => {
      const resolver = mock((name: string) => `/custom/root/${name}`);
      const d = new PlaywrightCliDriver({ runner: createMockRunner(), profileDirResolver: resolver });
      const args = d.buildOpenHeadlessArgs("https://gemini.google.com/app", "p1", "s1");
      expect(args).toContain("--profile=/custom/root/p1");
      expect(resolver).toHaveBeenCalledWith("p1");
    });

    test("openHeadless runs the CLI with expected headless args", async () => {
      const runner = createMockRunner();
      const d = new PlaywrightCliDriver({ runner });
      await d.openHeadless("https://gemini.google.com/app", "p1", "s1");
      expect(runner._run).toHaveBeenCalledTimes(1);
      const args = runner._run.mock.calls[0]![0] as string[];
      expect(args[0]).toBe("-s=s1");
      expect(args).toContain("open");
      expect(args).toContain("--browser=chromium");
      expect(args).toContain("https://gemini.google.com/app");
      expect(args).not.toContain("--headed");
      expect(args).not.toContain("--persistent");
    });

    test("openHeadless throws PlaywrightCliError when open command fails", async () => {
      const runner = createMockRunner();
      runner._run.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "open failed" });
      const d = new PlaywrightCliDriver({ runner });
      await expect(d.openHeadless("https://gemini.google.com/app", "p1", "s1")).rejects.toBeInstanceOf(PlaywrightCliError);
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

  describe("strategy", () => {
    test("exposes the runner's strategy", () => {
      const d1 = new PlaywrightCliDriver({ runner: createMockRunner("direct") });
      expect(d1.strategy).toBe("direct");
      const d2 = new PlaywrightCliDriver({ runner: createMockRunner("bunx") });
      expect(d2.strategy).toBe("bunx");
    });
  });

  describe("auto-detection", () => {
    test("selects bunx strategy when direct probe fails and bunx probe succeeds", async () => {
      const direct = createMockRunner("direct");
      direct._run.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "not found" });
      const bunx = createMockRunner("bunx");
      bunx._run.mockResolvedValue({ exitCode: 0, stdout: "0.1.17", stderr: "" });

      const d = new PlaywrightCliDriver({ probeRunners: [direct, bunx] });

      await d.runCli(["--version"]);

      expect(d.strategy).toBe("bunx");
      expect(direct._run).toHaveBeenCalled();
      expect(bunx._run).toHaveBeenCalled();
    });

    test("runCli throws PlaywrightCliUnavailableError when all probe candidates fail", async () => {
      const direct = createMockRunner("direct");
      direct._run.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
      const bunx = createMockRunner("bunx");
      bunx._run.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });

      const d = new PlaywrightCliDriver({ probeRunners: [direct, bunx] });

      await expect(d.runCli(["--version"])).rejects.toBeInstanceOf(
        PlaywrightCliUnavailableError,
      );
    });

    test("does not probe when a runner is injected", async () => {
      const runner = createMockRunner("direct");
      const probeCandidate = createMockRunner("bunx");
      const d = new PlaywrightCliDriver({ runner, probeRunners: [probeCandidate] });

      await d.runCli(["--version"]);

      expect(probeCandidate._run).not.toHaveBeenCalled();
      expect(runner._run).toHaveBeenCalledTimes(1);
    });

    test("probes at most once across repeated isAvailable calls", async () => {
      const candidate = createMockRunner("bunx");
      candidate._run.mockResolvedValue({ exitCode: 0, stdout: "1.0.0", stderr: "" });
      const d = new PlaywrightCliDriver({ probeRunners: [candidate] });

      await d.isAvailable();
      await d.isAvailable();

      expect(candidate._run).toHaveBeenCalledTimes(1);
    });
  });
});
