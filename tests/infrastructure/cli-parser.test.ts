import { describe, test, expect } from "bun:test";
import { parseGlobalArgs, printVersion } from "../../src/infrastructure/cli-parser.ts";

describe("parseGlobalArgs", () => {
  test("--verbose long sets verbose", () => {
    const r = parseGlobalArgs(["--verbose", "list"]);
    expect(r.flags.verbose).toBe(true);
    expect(r.flags.version).toBe(false);
    expect(r.flags.help).toBe(false);
    expect(r.subcommand).toBe("list");
    expect(r.subcommandArgs).toEqual([]);
  });

  test("-v short sets verbose", () => {
    const r = parseGlobalArgs(["-v", "list"]);
    expect(r.flags.verbose).toBe(true);
    expect(r.subcommand).toBe("list");
    expect(r.subcommandArgs).toEqual([]);
  });

  test("--version sets version with no subcommand", () => {
    const r = parseGlobalArgs(["--version"]);
    expect(r.flags.version).toBe(true);
    expect(r.flags.verbose).toBe(false);
    expect(r.flags.help).toBe(false);
    expect(r.subcommand).toBeNull();
    expect(r.subcommandArgs).toEqual([]);
  });

  test("--help long sets help with no subcommand", () => {
    const r = parseGlobalArgs(["--help"]);
    expect(r.flags.help).toBe(true);
    expect(r.flags.verbose).toBe(false);
    expect(r.flags.version).toBe(false);
    expect(r.subcommand).toBeNull();
    expect(r.subcommandArgs).toEqual([]);
  });

  test("-h short sets help with no subcommand", () => {
    const r = parseGlobalArgs(["-h"]);
    expect(r.flags.help).toBe(true);
    expect(r.subcommand).toBeNull();
    expect(r.subcommandArgs).toEqual([]);
  });

  test("subcommand args passthrough", () => {
    const r = parseGlobalArgs(["list", "--limit", "5", "--format", "json"]);
    expect(r.flags.verbose).toBe(false);
    expect(r.subcommand).toBe("list");
    expect(r.subcommandArgs).toEqual(["--limit", "5", "--format", "json"]);
  });

  test("global flags and subcommand args combine", () => {
    const r = parseGlobalArgs(["-v", "fetch", "abc123", "--format", "json"]);
    expect(r.flags.verbose).toBe(true);
    expect(r.subcommand).toBe("fetch");
    expect(r.subcommandArgs).toEqual(["abc123", "--format", "json"]);
  });

  test("empty argv returns all-false flags and null subcommand", () => {
    const r = parseGlobalArgs([]);
    expect(r.flags.verbose).toBe(false);
    expect(r.flags.version).toBe(false);
    expect(r.flags.help).toBe(false);
    expect(r.subcommand).toBeNull();
    expect(r.subcommandArgs).toEqual([]);
  });

  test("unknown global option throws project-shaped error", () => {
    expect(() => parseGlobalArgs(["--bogus"])).toThrow(/^gemiterm: /);
  });

  test("unknown option in subcommand args does not throw", () => {
    const r = parseGlobalArgs(["list", "--unknown", "value"]);
    expect(r.subcommand).toBe("list");
    expect(r.subcommandArgs).toEqual(["--unknown", "value"]);
  });
});

describe("printVersion", () => {
  test("prints gemiterm v<version>", () => {
    const log = console.log;
    const captured: string[] = [];
    console.log = (msg: string) => { captured.push(String(msg)); };
    try {
      printVersion("2.1.0");
    } finally {
      console.log = log;
    }
    expect(captured).toEqual(["gemiterm v2.1.0"]);
  });
});
