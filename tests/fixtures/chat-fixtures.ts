import type { ChatInfo, Message, Conversation } from "../../src/core/types.ts";

export interface MockChatInfoOptions {
  count?: number;
  ids?: string[];
  titles?: string[];
  pinnedIndices?: number[];
  baseTimestamp?: number;
}

export function createMockChatList(options: MockChatInfoOptions = {}): ChatInfo[] {
  const {
    count = 3,
    ids,
    titles,
    pinnedIndices = [],
    baseTimestamp = Date.now(),
  } = options;

  const defaultIds = ["conv-abc123", "conv-def456", "conv-ghi789", "conv-jkl012", "conv-mno345"];
  const defaultTitles = [
    "Chat about TypeScript",
    "Pinned conversation",
    "Bun runtime overview",
    "Testing strategies",
    "Deployment options",
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: ids?.[i] ?? defaultIds[i] ?? `conv-${i}`,
    title: titles?.[i] ?? defaultTitles[i] ?? `Untitled chat ${i + 1}`,
    isPinned: pinnedIndices.includes(i),
    timestamp: baseTimestamp - i * 86400000,
  }));
}

export interface MockMessageOptions {
  count?: number;
  conversationId?: string;
  roles?: Array<"user" | "model">;
  contents?: string[];
}

export function createMockMessageHistory(options: MockMessageOptions = {}): Message[] {
  const {
    count = 4,
    conversationId,
    roles,
    contents,
  } = options;

  const defaultRoles: Array<"user" | "model"> = ["user", "model", "user", "model"];
  const defaultContents = [
    "Hello, Gemini!",
    "Hi there! How can I help you today?",
    "Tell me about TypeScript.",
    "TypeScript is a typed superset of JavaScript.",
  ];

  return Array.from({ length: count }, (_, i) => ({
    role: roles?.[i] ?? defaultRoles[i % defaultRoles.length],
    content: contents?.[i] ?? defaultContents[i % defaultContents.length],
    ...(conversationId ? { conversationId } : {}),
  }));
}

export interface MockConversationOptions {
  id?: string;
  title?: string;
  messages?: Message[];
  messageCount?: number;
}

export function createMockConversation(options: MockConversationOptions = {}): Conversation {
  const {
    id = "conv-abc123",
    title = "Chat about TypeScript",
    messages,
    messageCount = 4,
  } = options;

  return {
    id,
    title,
    messages: messages ?? createMockMessageHistory({ count: messageCount, conversationId: id }),
  };
}
