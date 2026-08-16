import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { runInteractiveLoop, type InteractiveLoopDeps, type SessionKeepaliveHandle } from "../../../src/cli/utils/interactive-prompt.ts";
import { CancellationError } from "../../../src/cli/utils/prompts.ts";

class MockCancellationError extends Error {
  name = "CancellationError" as const;
  constructor(message?: string) {
    super(message);
    this.name = "CancellationError";
  }
}

function makeDeps(
  responses: string[],
  shouldThrow = false,
  keepalive?: SessionKeepaliveHandle,
): InteractiveLoopDeps & {
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
    keepalive,
  };
}

function makeKeepaliveMock() {
  return {
    start: mock(() => {}),
    stop: mock(() => {}),
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

describe("keepalive lifecycle", () => {
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

  test("keepalive.start() is called once on REPL entry", async () => {
    const keepalive = makeKeepaliveMock();
    const deps = makeDeps(["/exit"], false, keepalive);
    const messageHandler = mock(async () => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(keepalive.start).toHaveBeenCalledTimes(1);
  });

  test("keepalive.stop() is called on normal /exit", async () => {
    const keepalive = makeKeepaliveMock();
    const deps = makeDeps(["/exit"], false, keepalive);
    const messageHandler = mock(async () => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(keepalive.stop).toHaveBeenCalledTimes(1);
  });

  test("keepalive.stop() is called on CancellationError", async () => {
    const keepalive = makeKeepaliveMock();
    const deps = makeDeps([], true, keepalive);
    const messageHandler = mock(async () => ({ response: "ok" }));

    try {
      await runInteractiveLoop(messageHandler, {}, deps);
    } catch {
      // error propagates; we only care that stop was called
    }

    expect(keepalive.stop).toHaveBeenCalledTimes(1);
  });

  test("keepalive.stop() is called on error propagation", async () => {
    const keepalive = makeKeepaliveMock();
    const deps = makeDeps(["hello", "/exit"], false, keepalive);
    const messageHandler = mock(async () => {
      throw new Error("handler error");
    });

    try {
      await runInteractiveLoop(messageHandler, {}, deps);
    } catch {
      // error propagates; we only verify stop was called
    }

    expect(keepalive.stop).toHaveBeenCalledTimes(1);
  });

  test("no keepalive dep: loop runs without error (backward compat)", async () => {
    const deps = makeDeps(["/exit"], false);
    const messageHandler = mock(async () => ({ response: "ok" }));

    await runInteractiveLoop(messageHandler, {}, deps);

    expect(messageHandler).not.toHaveBeenCalled();
  });
});
