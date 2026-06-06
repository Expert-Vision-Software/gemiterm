import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Logger } from "../../src/infrastructure/logger.ts";

describe("Logger", () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    Logger.setVerbose(false);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test("info writes to stderr with correct format", () => {
    const logger = new Logger("test-module");
    logger.info("hello world");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(output).toContain("[INFO] [test-module] hello world");
  });

  test("warn writes to stderr with WARN level", () => {
    const logger = new Logger("cli");
    logger.warn("something happened");

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[WARN] [cli] something happened");
  });

  test("error writes to stderr with ERROR level", () => {
    const logger = new Logger("auth");
    logger.error("failed");

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[ERROR] [auth] failed");
  });

  test("debug is silent when verbose is off", () => {
    const logger = new Logger("test");
    logger.debug("should not appear");

    expect(stderrSpy).toHaveBeenCalledTimes(0);
  });

  test("debug writes to stderr when verbose is on", () => {
    Logger.setVerbose(true);
    const logger = new Logger("test");
    logger.debug("verbose message");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[DEBUG] [test] verbose message");
  });

  test("extra args are appended to message", () => {
    const logger = new Logger("svc");
    logger.info("result", 42, "extra");

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[svc] result 42 extra");
  });

  test("isVerbose returns current verbose state", () => {
    expect(Logger.isVerbose()).toBe(false);
    Logger.setVerbose(true);
    expect(Logger.isVerbose()).toBe(true);
    Logger.setVerbose(false);
    expect(Logger.isVerbose()).toBe(false);
  });
});
