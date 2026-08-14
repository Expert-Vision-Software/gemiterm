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
import { render } from "@inquirer/testing";
import { input } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";

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

describe("text delegates to @inquirer/input", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns the typed value", async () => {
    const { answer, events } = await render(input, { message: "Your name" });
    events.type("Alice");
    events.keypress("enter");
    await expect(answer).resolves.toBe("Alice");
  });

  test("uses the default on empty submit", async () => {
    const { answer, events } = await render(input, { message: "Path", default: "default.md" });
    events.keypress("enter");
    await expect(answer).resolves.toBe("default.md");
  });

  test("forwards config and maps ExitPromptError to CancellationError", async () => {
    const inputMock = mock(async () => {
      throw new ExitPromptError("cancelled");
    });
    mock.module("@inquirer/prompts", () => ({
      input: inputMock,
      confirm: () => {
        throw new Error("unused");
      },
      select: () => {
        throw new Error("unused");
      },
    }));

    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      const validate = (v: string) => v.length > 0 || "required";
      await expect(text({ message: "hi", default: "d", validate })).rejects.toBeInstanceOf(
        CancellationError,
      );
      expect(inputMock).toHaveBeenCalledTimes(1);
      const config = inputMock.mock.calls[0][0] as {
        message: string;
        default?: string;
        validate?: unknown;
        theme?: unknown;
      };
      expect(config.message).toBe("hi");
      expect(config.default).toBe("d");
      expect(config.validate).toBe(validate);
      expect(config.theme).toBeDefined();
    } finally {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
    }
  });
});
