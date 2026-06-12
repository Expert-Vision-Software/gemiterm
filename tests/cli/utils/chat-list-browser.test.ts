import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render } from "@inquirer/testing";
import {
  browser,
  browserPrompt,
  truncateTitle,
  NonInteractiveError,
} from "../../../src/cli/utils/prompts.ts";
import type { ChatInfo } from "../../../src/core/types.ts";

const SAMPLE_CHATS: ChatInfo[] = [
  { id: "abc", title: "React hooks", isPinned: true, timestamp: 1717000000000 },
  { id: "def", title: "TypeScript types", isPinned: false, timestamp: 1717100000000 },
  { id: "ghi", title: "Bun runtime", isPinned: false, timestamp: 1716900000000 },
];

const LONG_TITLE = "a".repeat(80);

describe("browser prompt", () => {
  let stdinDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
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

  test("arrow down moves the cursor to the next row", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    const before = getScreen();
    expect(before).toContain("> def");

    events.keypress({ name: "down" });

    const after = getScreen();
    expect(after).toContain("> abc");
    expect(after).not.toContain("> def");
  });

  test("/ opens the search input, typing fills it, Enter narrows the list", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    events.keypress("/");
    for (const ch of "React") {
      events.keypress(ch);
    }

    const searchScreen = getScreen();
    expect(searchScreen).toContain("Search:");
    expect(searchScreen).toContain("React");

    events.keypress({ name: "enter" });

    const narrowed = getScreen();
    expect(narrowed).toContain("React hooks");
    expect(narrowed).not.toContain("TypeScript types");
    expect(narrowed).not.toContain("Bun runtime");
  });

  test("s opens the sort menu with three options", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    events.keypress("s");

    const screen = getScreen();
    expect(screen).toContain("Sort:");
    expect(screen).toContain("(1) recent");
    expect(screen).toContain("(2) oldest");
    expect(screen).toContain("(3) alpha");
  });

  test("enter on a chat resolves with kind: 'pick' and the active chat", async () => {
    const { answer, events } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    events.keypress({ name: "enter" });

    const result = await answer;
    expect(result.kind).toBe("pick");
    if (result.kind === "pick") {
      expect(result.chat).toEqual(SAMPLE_CHATS[1]);
      expect(result.action).toBe("back");
    }
  });

  test("q resolves with kind: 'quit'", async () => {
    const { answer, events } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    events.keypress("q");

    const result = await answer;
    expect(result).toEqual({ kind: "quit" });
  });

  test("empty list shows 'No conversations found' and quits on q", async () => {
    const { answer, events, getScreen } = await render(browserPrompt, { chats: [] });

    const screen = getScreen();
    expect(screen).toContain("No conversations found");

    events.keypress("q");

    const result = await answer;
    expect(result).toEqual({ kind: "quit" });
  });
});

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
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
        writable: true,
      });
    }
  });

  test("browser throws NonInteractiveError when stdin is not a TTY", async () => {
    await expect(browser({ chats: SAMPLE_CHATS })).rejects.toBeInstanceOf(
      NonInteractiveError,
    );
  });
});

describe("truncateTitle", () => {
  test("returns the title unchanged when shorter than 55 chars", () => {
    expect(truncateTitle("React hooks")).toBe("React hooks");
    expect(truncateTitle("")).toBe("");
  });

  test("returns the title unchanged when exactly 55 chars", () => {
    const title = "a".repeat(55);
    expect(truncateTitle(title)).toBe(title);
  });

  test("truncates titles longer than 55 chars and appends an ellipsis", () => {
    const result = truncateTitle(LONG_TITLE);
    expect(result.length).toBe(55);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toBe("a".repeat(54) + "…");
  });

  test("truncates a 56-char title to 55 chars (54 + ellipsis)", () => {
    const title = "a".repeat(56);
    const result = truncateTitle(title);
    expect(result).toBe("a".repeat(54) + "…");
  });
});

describe("browser prompt title rendering", () => {
  let stdinDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
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

  test("long titles are truncated with an ellipsis in the rendered row", async () => {
    const longChats: ChatInfo[] = [
      { id: "long", title: LONG_TITLE, isPinned: false, timestamp: 1717000000000 },
    ];
    const { getScreen } = await render(browserPrompt, { chats: longChats });

    const screen = getScreen({ raw: true });

    expect(screen).toContain("a".repeat(54));
    expect(screen).toContain("…");
  });
});
