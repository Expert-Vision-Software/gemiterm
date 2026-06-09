import { describe, test, expect } from "bun:test";
import {
  formatChatAsMarkdown,
  formatChatAsJson,
  formatProfileTable,
  formatChatList,
} from "../../src/infrastructure/formatters.ts";
import type { Message, ChatInfo, ProfileStatus } from "../../src/core/types.ts";

describe("formatters", () => {
  describe("formatChatAsMarkdown", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello Gemini" },
      { role: "model", content: "Hello! How can I help you?" },
    ];

    test("produces markdown with title heading", () => {
      const result = formatChatAsMarkdown(messages, "Test Chat");
      expect(result).toContain("# Test Chat");
    });

    test("separates title heading with blank line", () => {
      const result = formatChatAsMarkdown(messages, "Test Chat");
      expect(result).toContain("# Test Chat\n\n");
    });

    test("labels user messages as **You:**", () => {
      const result = formatChatAsMarkdown(messages, "Test Chat");
      expect(result).toContain("**You:**");
    });

    test("labels model messages as **Gemini:**", () => {
      const result = formatChatAsMarkdown(messages, "Test Chat");
      expect(result).toContain("**Gemini:**");
    });

    test("includes message content after label", () => {
      const result = formatChatAsMarkdown(messages, "Test Chat");
      expect(result).toContain("**You:**\n\nHello Gemini");
    });

    test("separates messages with horizontal rule", () => {
      const result = formatChatAsMarkdown(messages, "Test Chat");
      expect(result).toContain("---");
    });

    test("handles empty messages array", () => {
      const result = formatChatAsMarkdown([], "Empty Chat");
      expect(result).toContain("# Empty Chat");
      expect(result).not.toContain("**You:**");
      expect(result).not.toContain("**Gemini:**");
    });

    test("handles single message", () => {
      const single: Message[] = [{ role: "user", content: "Solo message" }];
      const result = formatChatAsMarkdown(single, "Solo");
      expect(result).toContain("**You:**");
      expect(result).toContain("Solo message");
      expect(result).toContain("---");
    });

    test("includes metadata when includeMetadata and conversationId are provided", () => {
      const result = formatChatAsMarkdown(messages, "Test", "conv-123", true);
      expect(result).toContain("> Conversation ID: conv-123");
      expect(result).toContain("> Messages: 2");
      expect(result).toContain("> Exported:");
    });

    test("excludes metadata when includeMetadata is false", () => {
      const result = formatChatAsMarkdown(messages, "Test", "conv-123", false);
      expect(result).not.toContain("> Conversation ID:");
    });

    test("excludes metadata when includeMetadata is undefined", () => {
      const result = formatChatAsMarkdown(messages, "Test", "conv-123");
      expect(result).not.toContain("> Conversation ID:");
    });

    test("excludes metadata when conversationId is missing", () => {
      const result = formatChatAsMarkdown(messages, "Test", undefined, true);
      expect(result).not.toContain("> Conversation ID:");
    });
  });

  describe("formatChatAsJson", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "model", content: "Hi there" },
    ];

    test("produces valid JSON", () => {
      const result = formatChatAsJson(messages, "conv-1");
      expect(() => JSON.parse(result)).not.toThrow();
    });

    test("includes conversationId in output", () => {
      const result = formatChatAsJson(messages, "conv-1");
      const parsed = JSON.parse(result);
      expect(parsed.conversationId).toBe("conv-1");
    });

    test("includes all messages in output", () => {
      const result = formatChatAsJson(messages, "conv-1");
      const parsed = JSON.parse(result);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].role).toBe("user");
      expect(parsed.messages[1].role).toBe("model");
    });

    test("preserves message content", () => {
      const result = formatChatAsJson(messages, "conv-1");
      const parsed = JSON.parse(result);
      expect(parsed.messages[0].content).toBe("Hello");
      expect(parsed.messages[1].content).toBe("Hi there");
    });

    test("pretty-prints JSON with 2-space indentation", () => {
      const result = formatChatAsJson(messages, "conv-1");
      expect(result).toContain("  \"conversationId\"");
    });

    test("handles empty messages array", () => {
      const result = formatChatAsJson([], "conv-empty");
      const parsed = JSON.parse(result);
      expect(parsed.messages).toEqual([]);
      expect(parsed.conversationId).toBe("conv-empty");
    });
  });

  describe("formatProfileTable", () => {
    test("returns 'No profiles found' message for empty array", () => {
      const result = formatProfileTable([]);
      expect(result).toContain("No profiles found");
      expect(result).toContain("gemiterm login");
    });

    test("includes header row with column names", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: null, isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("NAME");
      expect(result).toContain("ACTIVE");
      expect(result).toContain("EXPIRES");
      expect(result).toContain("DEFAULT");
    });

    test("includes separator row", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: null, isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      const lines = result.split("\n");
      const headerIdx = lines.findIndex((l) => l.includes("NAME"));
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(lines[headerIdx + 1]).toMatch(/^[─]+$/);
    });

    test("shows profile name", () => {
      const statuses: ProfileStatus[] = [
        { name: "work", exists: true, isActive: true, expiresAt: null, isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("work");
    });

    test("marks default profile with asterisk", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: null, isDefault: true },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("default");
      expect(result).toContain("Yes");
      expect(result).toContain("* = default profile");
    });

    test("shows 'Session' for active profile with null expiresAt (session cookie)", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: null, isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("Session");
      expect(result).not.toContain("N/A");
    });

    test("shows N/A for expiresAt when inactive and null", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: false, expiresAt: null, isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("N/A");
    });

    test("shows dash for profile that does not exist", () => {
      const statuses: ProfileStatus[] = [
        { name: "missing", exists: false, isActive: false, expiresAt: null, isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      const lines = result.split("\n");
      const dataLine = lines.find((l) => l.includes("missing"));
      expect(dataLine).toBeTruthy();
    });

    test("handles multiple profiles", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: "2026-12-31T00:00:00Z", isDefault: true },
        { name: "work", exists: true, isActive: false, expiresAt: "2026-06-30T00:00:00Z", isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("default");
      expect(result).toContain("work");
    });

    test("formats expiration date", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: "2026-12-31T00:00:00Z", isDefault: false },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("2026");
    });

    test("does not truncate short default profile name (chalk-aware width)", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: null, isDefault: true },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toContain("default *");
      expect(result).not.toContain("defaul\u2026");
    });

    test("does not truncate 'Yes' in DEFAULT column for default profile", () => {
      const statuses: ProfileStatus[] = [
        { name: "default", exists: true, isActive: true, expiresAt: null, isDefault: true },
      ];
      const result = formatProfileTable(statuses);
      expect(result).toMatch(/Yes\s*$/m);
    });
  });

  describe("formatChatList", () => {
    test("returns 'No conversations found' message for empty array", () => {
      const result = formatChatList([]);
      expect(result).toContain("No conversations found");
    });

    test("includes header row with column names", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "Test Chat", isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      expect(result).toContain("ID");
      expect(result).toContain("TITLE");
      expect(result).toContain("DATE");
      expect(result).toContain("PIN");
    });

    test("includes separator row", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "Test Chat", isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      const lines = result.split("\n");
      const headerIdx = lines.findIndex((l) => l.includes("ID"));
      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(lines[headerIdx + 1]).toMatch(/^[─]+$/);
    });

    test("shows chat title", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "My Chat", isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      expect(result).toContain("My Chat");
    });

    test("shows total count footer", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "Chat 1", isPinned: false, timestamp: Date.now() },
        { id: "def456", title: "Chat 2", isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      expect(result).toContain("Total: 2 conversations");
    });

    test("uses singular 'conversation' for single item", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "Chat 1", isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      expect(result).toContain("Total: 1 conversation");
    });

    test("truncates long titles", () => {
      const longTitle = "A".repeat(100);
      const chats: ChatInfo[] = [
        { id: "abc123", title: longTitle, isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      expect(result).toContain("\u2026");
    });

    test("handles multiple chats", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "First", isPinned: false, timestamp: 1000000 },
        { id: "def456", title: "Second", isPinned: true, timestamp: 2000000 },
        { id: "ghi789", title: "Third", isPinned: false, timestamp: 3000000 },
      ];
      const result = formatChatList(chats);
      expect(result).toContain("First");
      expect(result).toContain("Second");
      expect(result).toContain("Third");
      expect(result).toContain("Total: 3 conversations");
    });

    test("shows formatted date", () => {
      const chats: ChatInfo[] = [
        { id: "abc123", title: "Test", isPinned: false, timestamp: Date.now() },
      ];
      const result = formatChatList(chats);
      const currentYear = new Date().getFullYear().toString();
      expect(result).toContain(currentYear);
    });
  });
});
