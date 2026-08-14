import chalk from "chalk";
import type { ChatInfo, Message } from "../../core/types.ts";
import { formatChatList } from "../../infrastructure/formatters.ts";
import { writeTextFile } from "../../infrastructure/io.ts";
import type { ExportStrategy, ExportResult } from "../../services/export-strategy.ts";

export type ChatListData = {
  kind: "chat-list";
  chats: ChatInfo[];
  includeProfileColumn: boolean;
};

export type ConversationData = {
  kind: "conversation";
  conversationId: string;
  messages: Message[];
  includeMetadata?: boolean;
};

export type BatchExportData = {
  kind: "batch-export";
  chats: ChatInfo[];
  outDir: string;
  since?: string;
  allProfiles?: boolean;
  includeMetadata?: boolean;
};

export type ChatOutputData = ChatListData | ConversationData | BatchExportData;

export type ChatOutputFormat = "text" | "json" | "markdown" | "md";

export interface ChatOutputSink {
  format: ChatOutputFormat;
  out?: string;
}

export interface RenderStrategies {
  single: ExportStrategy;
  batch: ExportStrategy;
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

function formatConversationText(conversationId: string, messages: Message[]): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`Conversation: ${chalk.cyan(conversationId)}`));
  lines.push("");

  if (messages.length === 0) {
    lines.push(chalk.dim("No messages found."));
  } else {
    for (const msg of messages) {
      const label =
        msg.role === "user" ? chalk.green.bold("User:") : chalk.blue.bold("Model:");
      lines.push(label);
      lines.push(msg.content);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function dispatch(content: string, out?: string): void {
  if (out) {
    writeTextFile(out, content);
    console.log(chalk.dim(`Output written to: ${out}`));
  } else {
    console.log(content);
  }
}

export async function render(
  data: ChatOutputData,
  sink: ChatOutputSink,
  strategies?: RenderStrategies,
): Promise<ExportResult[] | void> {
  if (data.kind === "batch-export") {
    if (!strategies) {
      throw new Error("batch-export rendering requires export strategies");
    }
    return strategies.batch.export(
      { kind: "batch", chats: data.chats, outDir: data.outDir },
      {
        since: data.since,
        allProfiles: data.allProfiles,
        includeMetadata: data.includeMetadata,
      },
    );
  }

  if (data.kind === "conversation") {
    if (sink.format === "markdown" || sink.format === "md") {
      if (!strategies) {
        throw new Error("markdown rendering requires export strategies");
      }
      return strategies.single.export(
        {
          kind: "single",
          conversationId: data.conversationId,
          messages: data.messages,
          format: "markdown",
          out: sink.out,
        },
        { includeMetadata: data.includeMetadata },
      );
    }

    if (sink.format === "json" && strategies) {
      return strategies.single.export(
        {
          kind: "single",
          conversationId: data.conversationId,
          messages: data.messages,
          format: "json",
          out: sink.out,
        },
        { includeMetadata: data.includeMetadata },
      );
    }

    const content =
      sink.format === "json"
        ? JSON.stringify({ conversationId: data.conversationId, messages: data.messages }, null, 2)
        : formatConversationText(data.conversationId, data.messages);
    dispatch(content, sink.out);
    return;
  }

  const content =
    sink.format === "json"
      ? JSON.stringify({ chats: data.chats }, null, 2)
      : formatChatList(data.chats, { includeProfileColumn: data.includeProfileColumn });
  dispatch(content, sink.out);
}
