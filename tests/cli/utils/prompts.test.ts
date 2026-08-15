import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import {
  text,
  confirm,
  select,
  browser,
  getAbortSignal,
  abortActivePrompts,
  resetAbortController,
  NonInteractiveError,
  CancellationError,
} from "../../../src/cli/utils/prompts.ts";
import { GemitermError } from "../../../src/core/errors.ts";

describe("TTY gate", () => {
  let stdinDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });

  test("text throws NonInteractiveError when stdin is not a TTY", async () => {
    await expect(text({ message: "hi" })).rejects.toBeInstanceOf(NonInteractiveError);
  });

  test("confirm throws NonInteractiveError when stdin is not a TTY", async () => {
    await expect(confirm({ message: "ok?" })).rejects.toBeInstanceOf(NonInteractiveError);
  });

  test("select throws NonInteractiveError when stdin is not a TTY", async () => {
    await expect(
      select({
        message: "choose",
        choices: [{ value: "a", label: "A" }],
      }),
    ).rejects.toBeInstanceOf(NonInteractiveError);
  });

  test("browser throws NonInteractiveError when stdin is not a TTY", async () => {
    await expect(browser({ chats: [] })).rejects.toBeInstanceOf(NonInteractiveError);
  });

  test("text NonInteractiveError message includes the gemiterm new command hint", async () => {
    try {
      await text({ message: "hi" });
      throw new Error("expected NonInteractiveError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NonInteractiveError);
      expect((error as Error).message).toContain('gemiterm new "Your message"');
    }
  });

  test("browser NonInteractiveError message includes the gemiterm list -i hint", async () => {
    try {
      await browser({ chats: [] });
      throw new Error("expected NonInteractiveError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NonInteractiveError);
      expect((error as Error).message).toContain("gemiterm list -i requires a TTY");
    }
  });
});

describe("error class hierarchy", () => {
  test("NonInteractiveError is an instance of GemitermError", () => {
    const err = new NonInteractiveError("foo");
    expect(err).toBeInstanceOf(GemitermError);
    expect(err).toBeInstanceOf(NonInteractiveError);
  });

  test("CancellationError is an instance of GemitermError", () => {
    const err = new CancellationError("foo");
    expect(err).toBeInstanceOf(GemitermError);
    expect(err).toBeInstanceOf(CancellationError);
  });

  test("NonInteractiveError.name is NonInteractiveError", () => {
    expect(new NonInteractiveError("foo").name).toBe("NonInteractiveError");
  });

  test("CancellationError.name is CancellationError", () => {
    expect(new CancellationError("foo").name).toBe("CancellationError");
  });
});

describe("abort signal", () => {
  beforeEach(() => {
    resetAbortController();
  });

  afterEach(() => {
    resetAbortController();
  });

  test("getAbortSignal returns an AbortSignal", () => {
    expect(getAbortSignal()).toBeInstanceOf(AbortSignal);
  });

  test("getAbortSignal returns the same signal across calls", () => {
    expect(getAbortSignal()).toBe(getAbortSignal());
  });

  test("abortActivePrompts causes the signal to be aborted", () => {
    const signal = getAbortSignal();
    expect(signal.aborted).toBe(false);
    abortActivePrompts();
    expect(signal.aborted).toBe(true);
  });

  test("resetAbortController creates a new un-aborted signal", () => {
    const first = getAbortSignal();
    abortActivePrompts();
    expect(first.aborted).toBe(true);
    resetAbortController();
    const second = getAbortSignal();
    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);
  });
});

describe("text raw terminal input", () => {
  const dataListeners: Array<(buf: Buffer) => void> = [];
  let isTtyDescriptor: PropertyDescriptor | undefined;
  let addedSetRawMode = false;

  beforeEach(() => {
    dataListeners.length = 0;
    isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    if (typeof process.stdin.setRawMode !== "function") {
      Object.defineProperty(process.stdin, "setRawMode", {
        value: () => process.stdin,
        configurable: true,
        writable: true,
      });
      addedSetRawMode = true;
    }
    spyOn(process.stdin, "on").mockImplementation((event: string, cb: unknown) => {
      if (event === "data") {
        dataListeners.push(cb as (buf: Buffer) => void);
      }
      return process.stdin as never;
    });
    spyOn(process.stdin, "removeListener").mockImplementation(() => process.stdin as never);
    spyOn(process.stdin, "resume").mockImplementation(() => process.stdin as never);
    spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    if (addedSetRawMode) {
      Reflect.deleteProperty(process.stdin, "setRawMode");
      addedSetRawMode = false;
    }
    if (isTtyDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", isTtyDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  });

  test("returns typed text and deletes on backspace", async () => {
    const promise = text({ message: "You" });
    const type = dataListeners[0]!;
    type(Buffer.from("HelloX"));
    type(Buffer.from([0x7f]));
    type(Buffer.from("\r"));
    await expect(promise).resolves.toBe("Hello");
  });

  test("uses the default on empty submit", async () => {
    const promise = text({ message: "Path", default: "default.md" });
    dataListeners[0]!(Buffer.from("\r"));
    await expect(promise).resolves.toBe("default.md");
  });

  test("rejects with CancellationError on Ctrl-C", async () => {
    const promise = text({ message: "You" });
    dataListeners[0]!(Buffer.from([0x03]));
    await expect(promise).rejects.toBeInstanceOf(CancellationError);
  });

  test("re-prompts on invalid submit and resolves once valid", async () => {
    const validate = (v: string) => (v.length > 0 ? true : "required");
    const promise = text({ message: "Name", validate });
    dataListeners[0]!(Buffer.from("\r"));
    dataListeners[0]!(Buffer.from("ok\r"));
    await expect(promise).resolves.toBe("ok");
  });
});
