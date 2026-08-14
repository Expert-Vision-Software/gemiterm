import { describe, test, expect, afterEach, spyOn, mock } from "bun:test";
import {
  parseCommandArgs,
  renderUsage,
  type ArgFlagSpec,
} from "../../../src/cli/utils/command-args.ts";

const BOOL_SPEC: readonly ArgFlagSpec[] = [
  { key: "force", long: "--force", short: "-f", type: "boolean", description: "skip", helpLabel: "--force, -f", default: false },
];

const STRING_SPEC: readonly ArgFlagSpec[] = [
  { key: "profile", long: "--profile", short: "-p", type: "string", description: "profile", helpLabel: "--profile, -p <name>", default: "" },
];

const REQUIRED_SPEC: readonly ArgFlagSpec[] = [
  { key: "profile", long: "--profile", short: "-p", type: "string", required: true, valueName: "profile name", description: "profile", helpLabel: "--profile, -p <name>", default: null },
];

const ENUM_SPEC: readonly ArgFlagSpec[] = [
  { key: "sort", long: "--sort", type: "enum", enum: ["recent", "oldest", "alpha"], description: "sort", helpLabel: "--sort <mode>", default: "recent" },
];

const INT_SPEC: readonly ArgFlagSpec[] = [
  { key: "limit", long: "--limit", short: "-n", type: "integer", description: "limit", helpLabel: "--limit, -n N", default: 0 },
];

describe("parseCommandArgs", () => {
  test("boolean flag sets true", () => {
    expect(parseCommandArgs(["--force"], BOOL_SPEC)).toMatchObject({ force: true });
  });

  test("boolean short alias sets true", () => {
    expect(parseCommandArgs(["-f"], BOOL_SPEC)).toMatchObject({ force: true });
  });

  test("boolean default stays false", () => {
    expect(parseCommandArgs([], BOOL_SPEC)).toMatchObject({ force: false });
  });

  test("tolerant string consumes the next token", () => {
    expect(parseCommandArgs(["--profile", "work"], STRING_SPEC)).toMatchObject({ profile: "work" });
  });

  test("tolerant string short alias consumes the next token", () => {
    expect(parseCommandArgs(["-p", "work"], STRING_SPEC)).toMatchObject({ profile: "work" });
  });

  test("tolerant string with no value yields empty string", () => {
    expect(parseCommandArgs(["--profile"], STRING_SPEC)).toMatchObject({ profile: "" });
  });

  test("tolerant string falls back to default when no value", () => {
    const spec = [{ key: "outDir", long: "--out-dir", type: "string" as const, description: "", helpLabel: "--out-dir", default: "./exports" }];
    expect(parseCommandArgs(["--out-dir"], spec)).toMatchObject({ outDir: "./exports" });
  });

  test("required string consumes a value", () => {
    expect(parseCommandArgs(["--profile", "work"], REQUIRED_SPEC)).toMatchObject({ profile: "work" });
  });

  test("required string errors and exits when value missing", () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as unknown as (code?: number) => never);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => parseCommandArgs(["--profile"], REQUIRED_SPEC)).toThrow("process.exit called");
      expect(errSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("required string errors when next token is a flag", () => {
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as unknown as (code?: number) => never);
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => parseCommandArgs(["--profile", "--force"], REQUIRED_SPEC)).toThrow("process.exit called");
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("enum accepts a valid value", () => {
    expect(parseCommandArgs(["--sort", "alpha"], ENUM_SPEC)).toMatchObject({ sort: "alpha" });
  });

  test("enum falls back to default on invalid value", () => {
    expect(parseCommandArgs(["--sort", "bogus"], ENUM_SPEC)).toMatchObject({ sort: "recent" });
  });

  test("integer parses via parseInt", () => {
    expect(parseCommandArgs(["--limit", "5"], INT_SPEC)).toMatchObject({ limit: 5 });
  });

  test("integer falls back to default on invalid value", () => {
    expect(parseCommandArgs(["--limit", "abc"], INT_SPEC)).toMatchObject({ limit: 0 });
  });

  test("unknown tokens are ignored", () => {
    expect(parseCommandArgs(["positional", "--nope"], BOOL_SPEC)).toMatchObject({ force: false });
  });
});

describe("renderUsage", () => {
  test("renders usage line, arguments, options, and footer", () => {
    const out = renderUsage({
      usageLine: "Usage: gemiterm fetch [conversation_id] [options]",
      arguments: [{ name: "conversation_id", description: "ID of the conversation to fetch (optional)" }],
      flags: STRING_SPEC,
      footer: ["If no conversation_id is provided, the list command will be invoked."],
    });

    expect(out).toContain("Usage: gemiterm fetch [conversation_id] [options]");
    expect(out).toContain("Arguments:");
    expect(out).toContain("conversation_id");
    expect(out).toContain("Options:");
    expect(out).toContain("--profile, -p <name>");
    expect(out).toContain("If no conversation_id is provided, the list command will be invoked.");
  });

  test("omits the arguments section when none provided", () => {
    const out = renderUsage({ usageLine: "Usage: gemiterm list [options]", flags: BOOL_SPEC });
    expect(out).toContain("Options:");
    expect(out).not.toContain("Arguments:");
  });

  test("renders the description line when provided", () => {
    const out = renderUsage({
      usageLine: "Usage: gemiterm auth [profileName] [options]",
      description: "Authenticate with Google Gemini.",
      flags: BOOL_SPEC,
    });
    expect(out).toContain("Authenticate with Google Gemini.");
  });
});
