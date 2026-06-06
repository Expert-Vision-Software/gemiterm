import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { PlaywrightCliDriver, PlaywrightCliError } from "../../src/services/playwright-cli-driver.ts";

describe("PlaywrightCliDriver", () => {
  let driver: PlaywrightCliDriver;

  beforeEach(() => {
    driver = new PlaywrightCliDriver();
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
      const result = await driver.runCli(["--version"]);
      expect(result).toBeTruthy();
    });

    test("rejects with PlaywrightCliError on non-zero exit", async () => {
      await expect(driver.runCli(["nonexistent-command"])).rejects.toBeInstanceOf(
        PlaywrightCliError,
      );
    });

    test("PlaywrightCliError has correct properties", async () => {
      try {
        await driver.runCli(["nonexistent-command"]);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PlaywrightCliError);
        const e = err as PlaywrightCliError;
        expect(e.name).toBe("PlaywrightCliError");
        expect(e.message).toContain("nonexistent-command");
      }
    });
  });

  describe("openHeaded", () => {
    test("constructs correct args without session", () => {
      const args = driver.buildOpenHeadedArgs("https://gemini.google.com", "my-profile");
      expect(args).toContain("open");
      expect(args).toContain("https://gemini.google.com");
      expect(args).toContain("--browser=chromium");
      expect(args).toContain("--headed");
      expect(args).toContain("--persistent");
      expect(args).toContain("--profile=my-profile");
      expect(args).not.toContain(expect.stringContaining("-s="));
    });

    test("includes session flag when provided", () => {
      const args = driver.buildOpenHeadedArgs("https://gemini.google.com", "my-profile", "my-session");
      expect(args[0]).toBe("-s=my-session");
    });
  });

  describe("evalJs", () => {
    test("passes expression with session and json flag", async () => {
      const runCliMock = mock(async (args: string[]) => {
        expect(args).toEqual(["-s=test-session", "eval", "() => document.title", "--json"]);
        return '"Gemini"';
      });
      driver.runCli = runCliMock;

      const result = await driver.evalJs("test-session", "() => document.title");
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

      const runCliMock = mock(async (args: string[]) => {
        expect(args).toEqual(["-s=sess1", "cookie-list", "--json"]);
        return cookieData;
      });
      driver.runCli = runCliMock;

      const cookies = await driver.cookieList("sess1");
      expect(cookies).toHaveLength(2);
      expect(cookies[0].name).toBe("__Secure-1PSID");
      expect(cookies[0].value).toBe("abc123");
      expect(cookies[0].secure).toBe(true);
      expect(cookies[1].sameSite).toBe("Lax");
    });

    test("returns empty array for invalid JSON", async () => {
      const runCliMock = mock(async () => "not-json");
      driver.runCli = runCliMock;

      const cookies = await driver.cookieList("sess1");
      expect(cookies).toEqual([]);
    });

    test("returns empty array for non-array JSON", async () => {
      const runCliMock = mock(async () => '{"error": "no cookies"}');
      driver.runCli = runCliMock;

      const cookies = await driver.cookieList("sess1");
      expect(cookies).toEqual([]);
    });

    test("handles cookies missing fields with defaults", async () => {
      const runCliMock = mock(async () =>
        JSON.stringify([{ name: "test-cookie", value: "val" }]),
      );
      driver.runCli = runCliMock;

      const cookies = await driver.cookieList("sess1");
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
      const runCliMock = mock(async (args: string[]) => {
        expect(args).toEqual(["-s=sess1", "state-save", "/tmp/state.json"]);
        return "";
      });
      driver.runCli = runCliMock;

      await driver.stateSave("sess1", "/tmp/state.json");
      expect(runCliMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("stateLoad", () => {
    test("passes correct args", async () => {
      const runCliMock = mock(async (args: string[]) => {
        expect(args).toEqual(["-s=sess1", "state-load", "/tmp/state.json"]);
        return "";
      });
      driver.runCli = runCliMock;

      await driver.stateLoad("sess1", "/tmp/state.json");
      expect(runCliMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("closeSession", () => {
    test("passes correct args", async () => {
      const runCliMock = mock(async (args: string[]) => {
        expect(args).toEqual(["-s=sess1", "close"]);
        return "";
      });
      driver.runCli = runCliMock;

      await driver.closeSession("sess1");
      expect(runCliMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("closeAll", () => {
    test("passes correct args without session", async () => {
      const runCliMock = mock(async (args: string[]) => {
        expect(args).toEqual(["close-all"]);
        return "";
      });
      driver.runCli = runCliMock;

      await driver.closeAll();
      expect(runCliMock).toHaveBeenCalledTimes(1);
    });
  });
});
