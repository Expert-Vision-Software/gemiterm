import chalk from "chalk";
import type { Message, ChatInfo, ProfileStatus } from "../core/types.ts";
import { renderTable, type ColumnDef } from "./cli-table.ts";

function formatDate(date: Date | string | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatChatAsMarkdown(
  messages: Message[],
  title: string,
  conversationId?: string,
  includeMetadata?: boolean,
): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");

  if (includeMetadata && conversationId) {
    lines.push(`> Conversation ID: ${conversationId}`);
    lines.push(`> Messages: ${messages.length}`);
    lines.push(`> Exported: ${new Date().toISOString()}`);
    lines.push("");
  }

  for (const msg of messages) {
    const label = msg.role === "user" ? "**You:**" : "**Gemini:**";
    lines.push(`${label}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export function formatChatAsJson(messages: Message[], conversationId: string): string {
  return JSON.stringify({ conversationId, messages }, null, 2);
}

export function formatProfileTable(statuses: ProfileStatus[]): string {
  const columns: ColumnDef<ProfileStatus>[] = [
    {
      header: "NAME",
      width: 18,
      cell: (s) => (s.isDefault ? chalk.green(s.name) + chalk.dim(" *") : s.name),
    },
    {
      header: "ACTIVE",
      width: 10,
      cell: (s) =>
        s.isActive
          ? chalk.green("\u2713 Yes")
          : s.exists
            ? chalk.red("\u2717 No")
            : chalk.dim("\u2014"),
    },
    {
      header: "EXPIRES",
      width: 22,
      cell: (s) => {
        if (s.expiresAt) return formatTimestamp(new Date(s.expiresAt).getTime());
        if (s.isActive) return chalk.dim("Session");
        return chalk.dim("N/A");
      },
    },
    {
      header: "LAST USED",
      width: 22,
      cell: (s) => (s.lastUsedAt ? formatTimestamp(new Date(s.lastUsedAt).getTime()) : chalk.dim("N/A")),
    },
    {
      header: "DEFAULT",
      width: 10,
      cell: (s) => (s.isDefault ? chalk.green("Yes") : ""),
    },
  ];

  return renderTable<ProfileStatus>({
    columns,
    rows: statuses,
    emptyMessage: "No profiles found. Run 'gemiterm login' to create one.",
    footer: "* = default profile",
  });
}

export function sortChats(
  chats: ChatInfo[],
  order: "recent" | "oldest" | "alpha",
): ChatInfo[] {
  const sorted = [...chats];
  switch (order) {
    case "recent":
      sorted.sort((a, b) => b.timestamp - a.timestamp);
      break;
    case "oldest":
      sorted.sort((a, b) => a.timestamp - b.timestamp);
      break;
    case "alpha":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return sorted;
}

export interface DateBounds {
  after?: string;
  before?: string;
  since?: string;
}

export function filterChatsByDate(chats: ChatInfo[], bounds: DateBounds): ChatInfo[] {
  return chats.filter((chat) => {
    const chatDate = new Date(chat.timestamp);
    if (bounds.after) {
      const afterDate = new Date(bounds.after);
      if (isNaN(afterDate.getTime())) return true;
      if (chatDate < afterDate) return false;
    }
    if (bounds.before) {
      const beforeDate = new Date(bounds.before);
      if (isNaN(beforeDate.getTime())) return true;
      if (chatDate > beforeDate) return false;
    }
    if (bounds.since) {
      const sinceDate = new Date(bounds.since);
      if (isNaN(sinceDate.getTime())) return true;
      if (chatDate < sinceDate) return false;
    }
    return true;
  });
}

export function formatChatList(chats: ChatInfo[], options?: { includeProfileColumn?: boolean }): string {
  const includeProfile = options?.includeProfileColumn === true;

  const columns: ColumnDef<ChatInfo>[] = [
    { header: "ID", width: 24, cell: (c) => chalk.dim(c.id) },
    { header: "TITLE", width: 40, cell: (c) => c.title },
    { header: "DATE", width: 22, cell: (c) => formatTimestamp(c.timestamp) },
    {
      header: "PIN",
      width: 6,
      cell: (c) => (c.isPinned ? chalk.yellow("\uD83D\uDCCC") : ""),
    },
  ];
  if (includeProfile) {
    columns.push({
      header: "PROFILE",
      width: 14,
      cell: (c) => c.profile ?? "",
    });
  }

  return renderTable<ChatInfo>({
    columns,
    rows: chats,
    emptyMessage: "No conversations found.",
    footer: `Total: ${chats.length} conversation${chats.length !== 1 ? "s" : ""}`,
  });
}
