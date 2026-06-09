import chalk from "chalk";
import type { Message, ChatInfo, ProfileStatus } from "../core/types.ts";

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

function visibleLength(str: string): number {
  let len = 0;
  let inEscape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (inEscape) {
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
        inEscape = false;
      }
      continue;
    }
    if (ch === "\u001b" && str[i + 1] === "[") {
      inEscape = true;
      i++;
      continue;
    }
    len++;
  }
  return len;
}

function truncate(str: string, maxLen: number): string {
  if (visibleLength(str) <= maxLen) return str;
  let out = "";
  let vis = 0;
  let inEscape = false;
  let i = 0;
  while (i < str.length && vis < maxLen - 1) {
    const ch = str[i]!;
    if (inEscape) {
      out += ch;
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
        inEscape = false;
      }
      i++;
      continue;
    }
    if (ch === "\u001b" && str[i + 1] === "[") {
      out += ch + "[";
      inEscape = true;
      i += 2;
      continue;
    }
    out += ch;
    vis++;
    i++;
  }
  return out + "\u2026";
}

function padColumn(value: string, width: number): string {
  const truncated = truncate(value, width);
  const pad = Math.max(0, width - visibleLength(truncated));
  return truncated + " ".repeat(pad);
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
  if (statuses.length === 0) {
    return chalk.dim("No profiles found. Run 'gemiterm login' to create one.");
  }

  const lines: string[] = [];

  const colName = 18;
  const colActive = 10;
  const colExpires = 22;
  const colDefault = 10;

  const header =
    padColumn("NAME", colName) +
    padColumn("ACTIVE", colActive) +
    padColumn("EXPIRES", colExpires) +
    padColumn("DEFAULT", colDefault);

  lines.push(chalk.bold(header));
  lines.push(header.replace(/./g, "\u2500"));

  for (const status of statuses) {
    const name = status.isDefault ? chalk.green(status.name) + chalk.dim(" *") : status.name;
    const active = status.isActive
      ? chalk.green("\u2713 Yes")
      : status.exists
        ? chalk.red("\u2717 No")
        : chalk.dim("\u2014");
    let expires: string;
    if (status.expiresAt) {
      expires = formatTimestamp(new Date(status.expiresAt).getTime());
    } else if (status.isActive) {
      expires = chalk.dim("Session");
    } else {
      expires = chalk.dim("N/A");
    }
    const defaultStr = status.isDefault ? chalk.green("Yes") : "";

    lines.push(
      padColumn(name as string, colName) +
        padColumn(active as string, colActive) +
        padColumn(expires as string, colExpires) +
        padColumn(defaultStr, colDefault),
    );
  }

  lines.push("");
  lines.push(chalk.dim("* = default profile"));

  return lines.join("\n");
}

export function formatChatList(chats: ChatInfo[], options?: { includeProfileColumn?: boolean }): string {
  if (chats.length === 0) {
    return chalk.dim("No conversations found.");
  }

  const lines: string[] = [];

  const colId = 24;
  const colTitle = 40;
  const colDate = 22;
  const colPin = 6;
  const colProfile = 14;

  const includeProfile = options?.includeProfileColumn === true;

  let header =
    padColumn("ID", colId) + padColumn("TITLE", colTitle) + padColumn("DATE", colDate) + padColumn("PIN", colPin);
  if (includeProfile) {
    header += padColumn("PROFILE", colProfile);
  }

  lines.push(chalk.bold(header));
  lines.push(header.replace(/./g, "\u2500"));

  for (const chat of chats) {
    const id = chalk.dim(chat.id);
    const title = truncate(chat.title, colTitle);
    const date = formatTimestamp(chat.timestamp);
    const pin = chat.isPinned ? chalk.yellow("\uD83D\uDCCC") : "";

    let row = padColumn(id, colId) + padColumn(title, colTitle) + padColumn(date, colDate) + padColumn(pin, colPin);
    if (includeProfile) {
      row += padColumn(chat.profile ?? "", colProfile);
    }
    lines.push(row);
  }

  lines.push("");
  lines.push(chalk.dim(`Total: ${chats.length} conversation${chats.length !== 1 ? "s" : ""}`));

  return lines.join("\n");
}
