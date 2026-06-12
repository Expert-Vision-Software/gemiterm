import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { runInteractiveLoop, type InteractiveLoopDeps } from "../../../src/cli/utils/interactive-prompt.ts";
import { CancellationError } from "../../../src/cli/utils/prompts.ts";

class MockCancellationError extends Error {
  name = "CancellationError" as const;
  constructor(message?: string) {
    super(message);
    this.name = "CancellationError";
  }
}

function makeDeps(responses: string[], shouldThrow = false): InteractiveLoopDeps & {
  text: ReturnType<typeof mock>;
} {
  const textMock = mock(async () => {
    if (shouldThrow) {
      throw new MockCancellationError("cancelled");
    }
    return responses.shift() ?? "";
  });
  return {
    text: textMock as unknown as InteractiveLoopDeps["text"],
    CancellationError: MockCancellationError as unknown as typeof CancellationError,
    text: textMock,
  };
}

describe("runInteractiveLoop", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("drives a 3-message sequence followed by /exit", async () => {
    const responses = ["hello", "how are you?", "goodbye", "/exit"];
    const deps = makeDeps(responses);
    const messageHandler = mock(async (_msg: string) => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(messageHandler).toHaveBeenCalledTimes(3);
  });

  test("passes trimmed user input to messageHandler", async () => {
    const responses = ["  hello  ", "  how are you?  ", "  goodbye  ", "/exit"];
    const deps = makeDeps(responses);
    const messageHandler = mock(async (_msg: string) => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(messageHandler).toHaveBeenCalledTimes(3);
    expect(messageHandler).toHaveBeenNthCalledWith(1, "hello");
    expect(messageHandler).toHaveBeenNthCalledWith(2, "how are you?");
    expect(messageHandler).toHaveBeenNthCalledWith(3, "goodbye");
  });

  test("resolves the loop after /exit", async () => {
    const responses = ["/exit"];
    const deps = makeDeps(responses);
    const messageHandler = mock(async (_msg: string) => ({ response: "ok" }));

    const start = Date.now();
    await runInteractiveLoop(messageHandler, {}, deps);
    const elapsed = Date.now() - start;

    expect(messageHandler).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(2000);
  });

  test("empty input does not invoke messageHandler", async () => {
    const responses = ["", "   ", "hello", "/exit"];
    const deps = makeDeps(responses);
    const messageHandler = mock(async (_msg: string) => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(messageHandler).toHaveBeenCalledTimes(1);
    expect(messageHandler).toHaveBeenCalledWith("hello");
  });

  test("CancellationError from facade resolves the loop", async () => {
    const deps = makeDeps([], true);
    const messageHandler = mock(async (_msg: string) => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(messageHandler).not.toHaveBeenCalled();
    expect(deps.text).toHaveBeenCalledTimes(1);
  });
});
