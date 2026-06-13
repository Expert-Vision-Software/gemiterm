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

const SAMPLE_CHATS_WITH_PROFILES: ChatInfo[] = [
  { id: "w1", title: "Work spec", isPinned: true, timestamp: 1717000000000, profile: "work" },
  { id: "p1", title: "Personal note", isPinned: false, timestamp: 1717100000000, profile: "personal" },
  { id: "w2", title: "Work review", isPinned: false, timestamp: 1716900000000, profile: "work" },
  { id: "p2", title: "Personal list", isPinned: true, timestamp: 1716800000000, profile: "personal" },
];

const SAMPLE_CHATS_NO_PINNED: ChatInfo[] = [
  { id: "u1", title: "Unpinned one", isPinned: false, timestamp: 1717000000000 },
  { id: "u2", title: "Unpinned two", isPinned: false, timestamp: 1716900000000 },
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

  test("s cycles through the three sort options (recent → oldest → alpha → recent)", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    expect(getScreen()).toContain("Sort: recent");

    events.keypress("s");
    expect(getScreen()).toContain("Sort: oldest");

    events.keypress("s");
    expect(getScreen()).toContain("Sort: alpha");

    events.keypress("s");
    expect(getScreen()).toContain("Sort: recent");
  });

  test("s keeps the cursor on the same row index when sort changes (clamped to new list length)", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    events.keypress({ name: "down" });
    expect(getScreen()).toContain("> abc");

    events.keypress("s");
    expect(getScreen()).toContain("Sort: oldest");
    expect(getScreen()).toContain("> abc");
  });

  test("p cycles through profile filter (all → work → personal → all)", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: SAMPLE_CHATS_WITH_PROFILES,
    });

    expect(getScreen()).toContain("Profile: all");

    events.keypress("p");
    expect(getScreen()).toContain("Profile: work");
    expect(getScreen()).not.toContain("Personal note");

    events.keypress("p");
    expect(getScreen()).toContain("Profile: personal");
    expect(getScreen()).not.toContain("Work spec");
    expect(getScreen()).not.toContain("Work review");

    events.keypress("p");
    expect(getScreen()).toContain("Profile: all");
  });

  test("p is a no-op when no chats have a profile", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    events.keypress("p");

    expect(getScreen()).toContain("Profile: all");
    expect(getScreen()).toContain("React hooks");
    expect(getScreen()).toContain("TypeScript types");
    expect(getScreen()).toContain("Bun runtime");
  });

  test("f toggles favorites filter on and off", async () => {
    const { events, getScreen } = await render(browserPrompt, { chats: SAMPLE_CHATS });

    expect(getScreen()).toContain("Favorites: off");
    expect(getScreen()).toContain("React hooks");

    events.keypress("f");
    expect(getScreen()).toContain("Favorites: on");
    expect(getScreen()).toContain("React hooks");
    expect(getScreen()).not.toContain("TypeScript types");
    expect(getScreen()).not.toContain("Bun runtime");

    events.keypress("f");
    expect(getScreen()).toContain("Favorites: off");
    expect(getScreen()).toContain("TypeScript types");
    expect(getScreen()).toContain("Bun runtime");
  });

  test("f and p work even when the visible list is empty (recovery from bad combo)", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: SAMPLE_CHATS_NO_PINNED,
    });

    events.keypress("f");
    expect(getScreen()).toContain("Favorites: on");
    expect(getScreen()).toContain("No conversations found");

    events.keypress("f");
    expect(getScreen()).toContain("Favorites: off");
    expect(getScreen()).toContain("Unpinned one");
    expect(getScreen()).toContain("Unpinned two");
  });

  test("p is a no-op when no profile filter narrows the list (single-profile data)", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: SAMPLE_CHATS_NO_PINNED,
    });

    events.keypress("p");
    expect(getScreen()).toContain("Profile: all");
    expect(getScreen()).toContain("Unpinned one");
  });

  test("p and f combine: work + favorites shows only pinned work chats", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: SAMPLE_CHATS_WITH_PROFILES,
    });

    events.keypress("p");
    events.keypress("f");

    const screen = getScreen();
    expect(screen).toContain("Profile: work");
    expect(screen).toContain("Favorites: on");
    expect(screen).toContain("Work spec");
    expect(screen).not.toContain("Work review");
    expect(screen).not.toContain("Personal note");
    expect(screen).not.toContain("Personal list");
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

describe("pagination", () => {
  let stdinDescriptor: PropertyDescriptor | undefined;
  let stdoutRowsDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    stdoutRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "rows", {
      value: 20,
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
    if (stdoutRowsDescriptor) {
      Object.defineProperty(process.stdout, "rows", stdoutRowsDescriptor);
    } else {
      Reflect.deleteProperty(process.stdout, "rows");
    }
  });

  const buildChats = (n: number): ChatInfo[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i.toString().padStart(2, "0")}`,
      title: `Chat ${i}`,
      isPinned: false,
      timestamp: 1717000000000 + i * 1000,
    }));

  test("a long list is windowed — not every row is rendered", async () => {
    const { getScreen } = await render(browserPrompt, { chats: buildChats(50) });

    const screen = getScreen();
    expect(screen).toContain("> c49");
    expect(screen).not.toContain("c00");
  });

  test("right arrow jumps the active row by pageSize", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: buildChats(20),
      pageSize: 5,
    });

    events.keypress({ name: "right" });

    const screen = getScreen();
    expect(screen).toContain("> c14");
    expect(screen).not.toContain("> c19");
  });

  test("right arrow clamps at the last row", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: buildChats(10),
      pageSize: 5,
    });

    events.keypress({ name: "right" });
    events.keypress({ name: "right" });

    expect(getScreen()).toContain("> c00");
  });

  test("left arrow clamps at the first row", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: buildChats(20),
      pageSize: 5,
    });

    events.keypress({ name: "left" });

    expect(getScreen()).toContain("> c19");
  });

  test("the BrowserConfig.pageSize override is honored", async () => {
    const { getScreen } = await render(browserPrompt, {
      chats: buildChats(10),
      pageSize: 3,
    });

    const screen = getScreen();
    expect(screen).toContain("> c09");
    expect(screen).toContain("c08");
    expect(screen).toContain("c07");
    expect(screen).not.toContain("c00");
  });

  test("down arrow through a paginated list keeps the cursor on the active row", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: buildChats(20),
      pageSize: 5,
    });

    events.keypress({ name: "down" });
    events.keypress({ name: "down" });
    events.keypress({ name: "down" });
    events.keypress({ name: "down" });
    events.keypress({ name: "down" });

    expect(getScreen()).toContain("> c14");
  });

  test("a filtered list shorter than pageSize renders all items (no empty-state)", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: SAMPLE_CHATS,
      pageSize: 20,
    });

    expect(getScreen()).toContain("React hooks");

    events.keypress("f");

    const screen = getScreen();
    expect(screen).toContain("React hooks");
    expect(screen).not.toContain("TypeScript types");
    expect(screen).not.toContain("Bun runtime");
    expect(screen).not.toContain("No conversations found");
  });

  test("the hint line advertises the page keys", async () => {
    const { getScreen } = await render(browserPrompt, { chats: buildChats(5) });

    expect(getScreen()).toContain("← → page");
  });

  test("pageSize defaults to 80% of (terminal rows - 4), floored at 5", async () => {
    const { getScreen } = await render(browserPrompt, { chats: buildChats(50) });

    const screen = getScreen();
    expect(screen).toContain("> c49");
    expect(screen).not.toContain("c00");
  });

  test("the title bar shows a Page: X/Y indicator when the list spans multiple pages", async () => {
    const { getScreen } = await render(browserPrompt, {
      chats: buildChats(20),
      pageSize: 5,
    });

    expect(getScreen()).toContain("Page: 1/4");
  });

  test("the page indicator updates when the user pages with →", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: buildChats(20),
      pageSize: 5,
    });

    events.keypress({ name: "right" });

    expect(getScreen()).toContain("Page: 2/4");
  });

  test("the page indicator clamps at the last page when → goes past the end", async () => {
    const { events, getScreen } = await render(browserPrompt, {
      chats: buildChats(10),
      pageSize: 5,
    });

    events.keypress({ name: "right" });
    events.keypress({ name: "right" });

    expect(getScreen()).toContain("Page: 2/2");
  });

  test("the page indicator is hidden when the list fits on a single page", async () => {
    const { getScreen } = await render(browserPrompt, {
      chats: buildChats(5),
      pageSize: 20,
    });

    expect(getScreen()).not.toContain("Page:");
  });
});
