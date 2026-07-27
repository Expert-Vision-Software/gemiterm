import { describe, test, expect } from "bun:test";
import {
  formatChatAsMarkdown,
  formatChatAsJson,
  formatProfileTable,
  formatChatList,
} from "../../src/infrastructure/formatters.ts";
import type { Message, ChatInfo, ProfileStatus } from "../../src/core/types.ts";

function makeMessages(): Message[] {
  return [
    { role: "user", content: "Hello, Gemini!" },
    { role: "model", content: "Hi there! How can I help you today?" },
    { role: "user", content: "Tell me about TypeScript." },
    { role: "model", content: "TypeScript is a typed superset of JavaScript." },
  ];
}

function makeChats(): ChatInfo[] {
  return [
    { id: "abc123", title: "Chat about TypeScript", isPinned: false, timestamp: Date.now() },
    { id: "def456", title: "Pinned conversation", isPinned: true, timestamp: Date.now() - 86400000 },
  ];
}

function makeStatuses(): ProfileStatus[] {
  return [
    {
      name: "default",
      exists: true,
      isActive: true,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      isDefault: true,
    },
    {
      name: "expired-profile",
      exists: true,
      isActive: false,
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
      isDefault: false,
    },
    {
      name: "missing-cookies",
      exists: true,
      isActive: false,
      expiresAt: null,
      isDefault: false,
    },
  ];
}

describe("formatChatAsMarkdown", () => {
  test("renders messages with proper markdown headers", () => {
    const messages = makeMessages();
    const result = formatChatAsMarkdown(messages, "Test Chat");

    expect(result).toContain("# Test Chat");
    expect(result).toContain("**You:**");
    expect(result).toContain("**Gemini:**");
    expect(result).toContain("Hello, Gemini!");
    expect(result).toContain("TypeScript is a typed superset of JavaScript.");
  });

  test("includes separator lines between messages", () => {
    const result = formatChatAsMarkdown(makeMessages(), "Title");
    const separatorCount = (result.match(/^---$/gm) ?? []).length;
    expect(separatorCount).toBe(4);
  });

  test("includes metadata when includeMetadata is true and conversationId provided", () => {
    const result = formatChatAsMarkdown(
      makeMessages(),
      "Meta Chat",
      "conv-xyz",
      true,
    );

    expect(result).toContain("> Conversation ID: conv-xyz");
    expect(result).toContain("> Messages: 4");
    expect(result).toContain("> Exported:");
  });

  test("omits metadata when includeMetadata is false", () => {
    const result = formatChatAsMarkdown(
      makeMessages(),
      "No Meta",
      "conv-xyz",
      false,
    );

    expect(result).not.toContain("> Conversation ID:");
    expect(result).not.toContain("> Messages:");
  });

  test("handles empty messages array", () => {
    const result = formatChatAsMarkdown([], "Empty Chat");
    expect(result).toContain("# Empty Chat");
    expect(result).not.toContain("**You:**");
    expect(result).not.toContain("**Gemini:**");
  });
});

describe("formatChatAsJson", () => {
  test("returns valid JSON with conversationId and messages", () => {
    const messages = makeMessages();
    const result = formatChatAsJson(messages, "conv-123");

    const parsed = JSON.parse(result);
    expect(parsed.conversationId).toBe("conv-123");
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.messages[0].role).toBe("user");
    expect(parsed.messages[0].content).toBe("Hello, Gemini!");
  });

  test("handles empty messages array", () => {
    const result = formatChatAsJson([], "conv-empty");
    const parsed = JSON.parse(result);
    expect(parsed.conversationId).toBe("conv-empty");
    expect(parsed.messages).toEqual([]);
  });
});

describe("formatProfileTable", () => {
  test("renders profile statuses in table format", () => {
    const statuses = makeStatuses();
    const result = formatProfileTable(statuses);

    expect(result).toContain("NAME");
    expect(result).toContain("ACTIVE");
    expect(result).toContain("EXPIRES");
    expect(result).toContain("LAST USED");
    expect(result).toContain("DEFAULT");
    expect(result).toContain("default");
    expect(result).toContain("expired-profile");
  });

  test("shows active checkmark for active profile", () => {
    const statuses = makeStatuses();
    const result = formatProfileTable(statuses);
    expect(result).toContain("\u2713");
  });

  test("shows inactive X for inactive profile", () => {
    const statuses = makeStatuses();
    const result = formatProfileTable(statuses);
    expect(result).toContain("\u2717");
  });

  test("shows default marker note", () => {
    const result = formatProfileTable(makeStatuses());
    expect(result).toContain("default profile");
  });

  test("returns message when no profiles exist", () => {
    const result = formatProfileTable([]);
    expect(result).toContain("No profiles found");
  });

  test("shows N/A for missing expiry date", () => {
    const statuses: ProfileStatus[] = [
      {
        name: "no-expiry",
        exists: true,
        isActive: true,
        expiresAt: null,
        isDefault: false,
      },
    ];
    const result = formatProfileTable(statuses);
    expect(result).toContain("no-expiry");
  });

  test("shows LAST USED timestamp when lastUsedAt is provided", () => {
    const statuses: ProfileStatus[] = [
      {
        name: "fresh",
        exists: true,
        isActive: true,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        lastUsedAt: new Date(Date.now() - 3600000).toISOString(),
        isDefault: false,
      },
    ];
    const result = formatProfileTable(statuses);
    expect(result).toContain("LAST USED");
    expect(result).not.toContain("N/A");
  });
});

describe("formatChatList", () => {
  test("renders chat list in table format", () => {
    const chats = makeChats();
    const result = formatChatList(chats);

    expect(result).toContain("ID");
    expect(result).toContain("TITLE");
    expect(result).toContain("DATE");
    expect(result).toContain("abc123");
    expect(result).toContain("Chat about TypeScript");
  });

  test("shows total count footer", () => {
    const result = formatChatList(makeChats());
    expect(result).toContain("Total: 2 conversations");
  });

  test("shows singular when only one chat", () => {
    const chats: ChatInfo[] = [
      { id: "solo", title: "Solo chat", isPinned: false, timestamp: Date.now() },
    ];
    const result = formatChatList(chats);
    expect(result).toContain("Total: 1 conversation");
  });

  test("returns message when no chats exist", () => {
    const result = formatChatList([]);
    expect(result).toContain("No conversations found");
  });
});
