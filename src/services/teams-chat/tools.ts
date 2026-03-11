import { graphRequest, type GraphCollectionResponse } from "../../graph/client.js";
import { buildODataQuery } from "../../graph/types.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { errorResult } from "../tool-utils.js";
import type { TeamsChat, TeamsChatMessage, TeamsChannel } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function senderName(msg: TeamsChatMessage): string {
  if (msg.from?.user?.displayName) return msg.from.user.displayName;
  if (msg.from?.application?.displayName) return `[App] ${msg.from.application.displayName}`;
  return "(unknown)";
}

function formatChatMessage(msg: TeamsChatMessage): string {
  if (msg.messageType !== "message") return "";
  const sender = senderName(msg);
  const time = formatTimestamp(msg.createdDateTime);
  const body = msg.body.contentType === "html"
    ? msg.body.content.replace(/<[^>]*>/g, "")
    : msg.body.content;
  return `[${time}] ${sender}: ${body}`;
}

function chatLabel(chat: TeamsChat): string {
  if (chat.topic) return chat.topic;
  if (chat.chatType === "oneOnOne") return "1:1 chat";
  if (chat.chatType === "meeting") return "Meeting chat";
  return "Group chat";
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function teamsListChatsTool(): AgentTool {
  return {
    name: "teams_list_chats",
    description:
      "List the current user's Teams chats (1:1, group, and meeting chats). Returns chat id, type, topic, and creation time.",
    inputSchema: {
      type: "object",
      properties: {
        top: {
          type: "number",
          description: "Maximum number of chats to return (default 20, max 50)",
        },
      },
    },
    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const top = Math.min(Number(input.top) || 20, 50);
      const query = buildODataQuery({
        $top: top,
        $orderby: "lastUpdatedDateTime desc",
      });

      const res = await graphRequest<GraphCollectionResponse<TeamsChat>>({
        token: ctx.token,
        path: `/me/chats${query}`,
      });

      if (!res.value.length) {
        return { content: "No chats found." };
      }

      const lines = res.value.map(
        (c) => `- **${chatLabel(c)}** (${c.chatType}) | id: ${c.id} | created: ${formatTimestamp(c.createdDateTime)}`,
      );
      return { content: lines.join("\n") };
    },
  };
}

export function teamsReadChatTool(): AgentTool {
  return {
    name: "teams_read_chat",
    description:
      "Read recent messages from a Teams chat. Requires the chat id.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "The chat id" },
        top: {
          type: "number",
          description: "Number of messages to retrieve (default 20, max 50)",
        },
      },
      required: ["chatId"],
    },
    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const chatId = input.chatId as string | undefined;
      if (!chatId) return errorResult("chatId is required.");

      const top = Math.min(Number(input.top) || 20, 50);
      const query = buildODataQuery({
        $top: top,
        $orderby: "createdDateTime desc",
      });

      const res = await graphRequest<GraphCollectionResponse<TeamsChatMessage>>({
        token: ctx.token,
        path: `/me/chats/${chatId}/messages${query}`,
      });

      const messages = res.value
        .map(formatChatMessage)
        .filter(Boolean)
        .reverse(); // chronological order

      if (!messages.length) {
        return { content: "No messages found in this chat." };
      }

      return { content: messages.join("\n") };
    },
  };
}

export function teamsSendTool(): AgentTool {
  return {
    name: "teams_send",
    description:
      "Send a message to a Teams chat. Requires the chat id and message content.",
    inputSchema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "The chat id" },
        content: { type: "string", description: "Message text to send" },
      },
      required: ["chatId", "content"],
    },
    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const chatId = input.chatId as string | undefined;
      const content = input.content as string | undefined;
      if (!chatId) return errorResult("chatId is required.");
      if (!content) return errorResult("content is required.");

      const msg = await graphRequest<TeamsChatMessage>({
        token: ctx.token,
        path: `/me/chats/${chatId}/messages`,
        method: "POST",
        body: { body: { content, contentType: "text" } },
      });

      return { content: `Message sent (id: ${msg.id}).` };
    },
  };
}

export function teamsListChannelsTool(): AgentTool {
  return {
    name: "teams_list_channels",
    description:
      "List channels in a Teams team. Requires the team id.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "The team id" },
      },
      required: ["teamId"],
    },
    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const teamId = input.teamId as string | undefined;
      if (!teamId) return errorResult("teamId is required.");

      const res = await graphRequest<GraphCollectionResponse<TeamsChannel>>({
        token: ctx.token,
        path: `/teams/${teamId}/channels`,
      });

      if (!res.value.length) {
        return { content: "No channels found." };
      }

      const lines = res.value.map(
        (ch) =>
          `- **${ch.displayName}** (${ch.membershipType}) | id: ${ch.id}${ch.description ? ` | ${ch.description}` : ""}`,
      );
      return { content: lines.join("\n") };
    },
  };
}

export function teamsChannelMessagesTool(): AgentTool {
  return {
    name: "teams_channel_messages",
    description:
      "Read recent messages from a Teams channel. Requires team id and channel id.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "The team id" },
        channelId: { type: "string", description: "The channel id" },
        top: {
          type: "number",
          description: "Number of messages to retrieve (default 20, max 50)",
        },
      },
      required: ["teamId", "channelId"],
    },
    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const teamId = input.teamId as string | undefined;
      const channelId = input.channelId as string | undefined;
      if (!teamId) return errorResult("teamId is required.");
      if (!channelId) return errorResult("channelId is required.");

      const top = Math.min(Number(input.top) || 20, 50);
      const query = buildODataQuery({
        $top: top,
        $orderby: "createdDateTime desc",
      });

      const res = await graphRequest<GraphCollectionResponse<TeamsChatMessage>>({
        token: ctx.token,
        path: `/teams/${teamId}/channels/${channelId}/messages${query}`,
      });

      const messages = res.value
        .map(formatChatMessage)
        .filter(Boolean)
        .reverse();

      if (!messages.length) {
        return { content: "No messages found in this channel." };
      }

      return { content: messages.join("\n") };
    },
  };
}

export function teamsSendChannelTool(): AgentTool {
  return {
    name: "teams_send_channel",
    description:
      "Send a message to a Teams channel. Requires team id, channel id, and message content.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "The team id" },
        channelId: { type: "string", description: "The channel id" },
        content: { type: "string", description: "Message text to send" },
      },
      required: ["teamId", "channelId", "content"],
    },
    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const teamId = input.teamId as string | undefined;
      const channelId = input.channelId as string | undefined;
      const content = input.content as string | undefined;
      if (!teamId) return errorResult("teamId is required.");
      if (!channelId) return errorResult("channelId is required.");
      if (!content) return errorResult("content is required.");

      const msg = await graphRequest<TeamsChatMessage>({
        token: ctx.token,
        path: `/teams/${teamId}/channels/${channelId}/messages`,
        method: "POST",
        body: { body: { content, contentType: "text" } },
      });

      return { content: `Message sent to channel (id: ${msg.id}).` };
    },
  };
}
