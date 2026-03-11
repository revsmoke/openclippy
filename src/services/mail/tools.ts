import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { errorResult, formatDateTime } from "../tool-utils.js";
import { graphRequest } from "../../graph/client.js";
import { buildODataQuery } from "../../graph/types.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type {
  GraphMessage,
  GraphMailFolder,
  GraphRecipient,
  SendMailPayload,
  ReplyPayload,
  ForwardPayload,
  MovePayload,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_MESSAGE_SELECT =
  "id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,isDraft,flag";

function formatRecipient(r: GraphRecipient): string {
  const name = r.emailAddress.name;
  const addr = r.emailAddress.address;
  return name ? `${name} <${addr}>` : addr;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function formatMessageSummary(m: GraphMessage): string {
  const from = m.from ? formatRecipient(m.from) : "Unknown";
  const to = m.toRecipients?.map(formatRecipient).join(", ") ?? "";
  const date = formatDateTime(m.receivedDateTime);
  const read = m.isRead ? "Read" : "Unread";
  const attach = m.hasAttachments ? " [Attachments]" : "";
  const flagged = m.flag?.flagStatus === "flagged" ? " [Flagged]" : "";
  const preview = truncate(m.bodyPreview ?? "", 120);

  return [
    `ID: ${m.id}`,
    `Subject: ${m.subject ?? "(no subject)"}`,
    `From: ${from}`,
    `To: ${to}`,
    `Date: ${date}`,
    `Status: ${read}${attach}${flagged}`,
    `Preview: ${preview}`,
  ].join("\n");
}

function parseRecipients(input: unknown): GraphRecipient[] | null {
  if (!input) return null;

  // Accept a comma-separated string of email addresses
  if (typeof input === "string") {
    return input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((addr) => ({ emailAddress: { address: addr } }));
  }

  // Accept an array of strings or recipient objects
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (typeof item === "string") {
        return { emailAddress: { address: item } };
      }
      // Already a recipient-like object
      if (item?.emailAddress?.address) {
        return item as GraphRecipient;
      }
      return { emailAddress: { address: String(item) } };
    });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool: mail_list
// ---------------------------------------------------------------------------

export function mailListTool(): AgentTool {
  return {
    name: "mail_list",
    description:
      "List recent emails from inbox. Optionally filter by folder and limit results.",
    inputSchema: {
      type: "object",
      properties: {
        top: {
          type: "number",
          description: "Number of messages to return (default 10, max 50)",
        },
        folderId: {
          type: "string",
          description:
            "Mail folder ID to list from (default: inbox). Use mail_folders to get folder IDs.",
        },
        filter: {
          type: "string",
          description: "OData filter expression (e.g. \"isRead eq false\")",
        },
      },
    },
    execute: async (input, context) => {
      const top = Math.min(Math.max(Number(input.top) || 10, 1), 50);
      const folderId = (input.folderId as string) || "inbox";
      const filter = input.filter as string | undefined;

      const query = buildODataQuery({
        $select: DEFAULT_MESSAGE_SELECT,
        $top: top,
        $orderby: "receivedDateTime desc",
        $filter: filter,
      });

      const basePath =
        folderId === "inbox"
          ? "/me/messages"
          : `/me/mailFolders/${folderId}/messages`;

      const result = await graphRequest<GraphCollectionResponse<GraphMessage>>({
        token: context.token,
        path: `${basePath}${query}`,
      });

      const messages = result.value ?? [];
      if (messages.length === 0) {
        return { content: "No messages found." };
      }

      const summaries = messages.map(formatMessageSummary);
      return {
        content: `Found ${messages.length} message(s):\n\n${summaries.join("\n\n---\n\n")}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_read
// ---------------------------------------------------------------------------

export function mailReadTool(): AgentTool {
  return {
    name: "mail_read",
    description:
      "Read a specific email message by ID. Returns full body content.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message ID to read",
        },
      },
      required: ["messageId"],
    },
    execute: async (input, context) => {
      const messageId = input.messageId as string;
      if (!messageId) return errorResult("messageId is required");

      const msg = await graphRequest<GraphMessage>({
        token: context.token,
        path: `/me/messages/${messageId}?$select=${DEFAULT_MESSAGE_SELECT},body,ccRecipients,conversationId`,
      });

      const from = msg.from ? formatRecipient(msg.from) : "Unknown";
      const to = msg.toRecipients?.map(formatRecipient).join(", ") ?? "";
      const cc =
        msg.ccRecipients?.map(formatRecipient).join(", ") || "(none)";
      const date = formatDateTime(msg.receivedDateTime);
      const body = msg.body?.content
        ? truncate(msg.body.content, 3000)
        : msg.bodyPreview ?? "";

      return {
        content: [
          `Subject: ${msg.subject ?? "(no subject)"}`,
          `From: ${from}`,
          `To: ${to}`,
          `CC: ${cc}`,
          `Date: ${date}`,
          `Read: ${msg.isRead ? "Yes" : "No"}`,
          `Attachments: ${msg.hasAttachments ? "Yes" : "No"}`,
          `Importance: ${msg.importance}`,
          "",
          "--- Body ---",
          body,
        ].join("\n"),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_search
// ---------------------------------------------------------------------------

export function mailSearchTool(): AgentTool {
  return {
    name: "mail_search",
    description:
      "Search emails using a keyword query. Searches subject, body, and sender.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
        top: {
          type: "number",
          description: "Max results to return (default 10, max 25)",
        },
      },
      required: ["query"],
    },
    execute: async (input, context) => {
      const query = input.query as string;
      if (!query) return errorResult("query is required");

      const top = Math.min(Math.max(Number(input.top) || 10, 1), 25);

      const odataQuery = buildODataQuery({
        $search: query,
        $select: DEFAULT_MESSAGE_SELECT,
        $top: top,
      });

      const result = await graphRequest<GraphCollectionResponse<GraphMessage>>({
        token: context.token,
        path: `/me/messages${odataQuery}`,
      });

      const messages = result.value ?? [];
      if (messages.length === 0) {
        return { content: `No messages found matching "${query}".` };
      }

      const summaries = messages.map(formatMessageSummary);
      return {
        content: `Found ${messages.length} result(s) for "${query}":\n\n${summaries.join("\n\n---\n\n")}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_send
// ---------------------------------------------------------------------------

export function mailSendTool(): AgentTool {
  return {
    name: "mail_send",
    description:
      "Send a new email. Provide recipients, subject, and body content.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description:
            "Comma-separated list of recipient email addresses",
        },
        subject: {
          type: "string",
          description: "Email subject",
        },
        body: {
          type: "string",
          description: "Email body (plain text or HTML)",
        },
        contentType: {
          type: "string",
          enum: ["text", "html"],
          description: "Body content type (default: text)",
        },
        cc: {
          type: "string",
          description:
            "Comma-separated CC recipients (optional)",
        },
        importance: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Message importance (default: normal)",
        },
      },
      required: ["to", "subject", "body"],
    },
    execute: async (input, context) => {
      const toRecipients = parseRecipients(input.to);
      if (!toRecipients || toRecipients.length === 0) {
        return errorResult("At least one recipient (to) is required");
      }

      const subject = input.subject as string;
      if (!subject) return errorResult("subject is required");

      const body = input.body as string;
      if (!body) return errorResult("body is required");

      const contentType =
        (input.contentType as "text" | "html") || "text";
      const importance =
        (input.importance as "low" | "normal" | "high") || "normal";

      const payload: SendMailPayload = {
        message: {
          subject,
          body: { contentType, content: body },
          toRecipients,
          importance,
        },
        saveToSentItems: true,
      };

      const ccRecipients = parseRecipients(input.cc);
      if (ccRecipients && ccRecipients.length > 0) {
        payload.message.ccRecipients = ccRecipients;
      }

      await graphRequest<void>({
        token: context.token,
        path: "/me/sendMail",
        method: "POST",
        body: payload,
      });

      const toAddrs = toRecipients
        .map((r) => r.emailAddress.address)
        .join(", ");
      return {
        content: `Email sent successfully to ${toAddrs} with subject "${subject}".`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_draft
// ---------------------------------------------------------------------------

export function mailDraftTool(): AgentTool {
  return {
    name: "mail_draft",
    description:
      "Create a draft email. The draft is saved but not sent.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Comma-separated list of recipient email addresses",
        },
        subject: {
          type: "string",
          description: "Email subject",
        },
        body: {
          type: "string",
          description: "Email body content",
        },
        contentType: {
          type: "string",
          enum: ["text", "html"],
          description: "Body content type (default: text)",
        },
      },
      required: ["subject", "body"],
    },
    execute: async (input, context) => {
      const subject = input.subject as string;
      if (!subject) return errorResult("subject is required");

      const body = input.body as string;
      if (!body) return errorResult("body is required");

      const contentType =
        (input.contentType as "text" | "html") || "text";

      const draftPayload: Record<string, unknown> = {
        subject,
        body: { contentType, content: body },
        isDraft: true,
      };

      const toRecipients = parseRecipients(input.to);
      if (toRecipients && toRecipients.length > 0) {
        draftPayload.toRecipients = toRecipients;
      }

      const created = await graphRequest<GraphMessage>({
        token: context.token,
        path: "/me/messages",
        method: "POST",
        body: draftPayload,
      });

      return {
        content: `Draft created successfully.\nID: ${created.id}\nSubject: ${created.subject}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_reply
// ---------------------------------------------------------------------------

export function mailReplyTool(): AgentTool {
  return {
    name: "mail_reply",
    description:
      "Reply to an email message. Sends a reply to the sender of the specified message.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message ID to reply to",
        },
        comment: {
          type: "string",
          description: "Reply message content",
        },
      },
      required: ["messageId", "comment"],
    },
    execute: async (input, context) => {
      const messageId = input.messageId as string;
      if (!messageId) return errorResult("messageId is required");

      const comment = input.comment as string;
      if (!comment) return errorResult("comment is required");

      const payload: ReplyPayload = { comment };

      await graphRequest<void>({
        token: context.token,
        path: `/me/messages/${messageId}/reply`,
        method: "POST",
        body: payload,
      });

      return { content: `Reply sent successfully to message ${messageId}.` };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_forward
// ---------------------------------------------------------------------------

export function mailForwardTool(): AgentTool {
  return {
    name: "mail_forward",
    description:
      "Forward an email message to specified recipients.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message ID to forward",
        },
        to: {
          type: "string",
          description: "Comma-separated list of recipient email addresses to forward to",
        },
        comment: {
          type: "string",
          description: "Optional comment to include with the forwarded message",
        },
      },
      required: ["messageId", "to"],
    },
    execute: async (input, context) => {
      const messageId = input.messageId as string;
      if (!messageId) return errorResult("messageId is required");

      const toRecipients = parseRecipients(input.to);
      if (!toRecipients || toRecipients.length === 0) {
        return errorResult("At least one recipient (to) is required");
      }

      const payload: ForwardPayload = { toRecipients };
      if (input.comment) {
        payload.comment = input.comment as string;
      }

      await graphRequest<void>({
        token: context.token,
        path: `/me/messages/${messageId}/forward`,
        method: "POST",
        body: payload,
      });

      const toAddrs = toRecipients
        .map((r) => r.emailAddress.address)
        .join(", ");
      return {
        content: `Message ${messageId} forwarded to ${toAddrs}.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_move
// ---------------------------------------------------------------------------

export function mailMoveTool(): AgentTool {
  return {
    name: "mail_move",
    description:
      "Move an email message to a different folder. Use mail_folders to find folder IDs.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message ID to move",
        },
        destinationId: {
          type: "string",
          description:
            "Destination folder ID (use mail_folders to find IDs, or well-known names like 'deleteditems', 'archive')",
        },
      },
      required: ["messageId", "destinationId"],
    },
    execute: async (input, context) => {
      const messageId = input.messageId as string;
      if (!messageId) return errorResult("messageId is required");

      const destinationId = input.destinationId as string;
      if (!destinationId) return errorResult("destinationId is required");

      const payload: MovePayload = { destinationId };

      const moved = await graphRequest<GraphMessage>({
        token: context.token,
        path: `/me/messages/${messageId}/move`,
        method: "POST",
        body: payload,
      });

      return {
        content: `Message moved successfully. New message ID: ${moved.id}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_flag
// ---------------------------------------------------------------------------

export function mailFlagTool(): AgentTool {
  return {
    name: "mail_flag",
    description:
      "Flag or unflag an email message for follow-up.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message ID to flag/unflag",
        },
        flagged: {
          type: "boolean",
          description: "true to flag, false to remove flag (default: true)",
        },
      },
      required: ["messageId"],
    },
    execute: async (input, context) => {
      const messageId = input.messageId as string;
      if (!messageId) return errorResult("messageId is required");

      const flagged = input.flagged !== false; // default true
      const flagStatus = flagged ? "flagged" : "notFlagged";

      await graphRequest<GraphMessage>({
        token: context.token,
        path: `/me/messages/${messageId}`,
        method: "PATCH",
        body: { flag: { flagStatus } },
      });

      return {
        content: `Message ${messageId} ${flagged ? "flagged" : "unflagged"} successfully.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_delete
// ---------------------------------------------------------------------------

export function mailDeleteTool(): AgentTool {
  return {
    name: "mail_delete",
    description:
      "Delete an email message. This permanently deletes the message.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message ID to delete",
        },
      },
      required: ["messageId"],
    },
    execute: async (input, context) => {
      const messageId = input.messageId as string;
      if (!messageId) return errorResult("messageId is required");

      await graphRequest<void>({
        token: context.token,
        path: `/me/messages/${messageId}`,
        method: "DELETE",
      });

      return { content: `Message ${messageId} deleted successfully.` };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: mail_folders
// ---------------------------------------------------------------------------

export function mailFoldersTool(): AgentTool {
  return {
    name: "mail_folders",
    description:
      "List mail folders. Returns folder names, IDs, and unread counts.",
    inputSchema: {
      type: "object",
      properties: {
        top: {
          type: "number",
          description: "Max folders to return (default 25)",
        },
      },
    },
    execute: async (input, context) => {
      const top = Math.min(Math.max(Number(input.top) || 25, 1), 100);

      const query = buildODataQuery({
        $top: top,
        $select: "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount",
      });

      const result = await graphRequest<
        GraphCollectionResponse<GraphMailFolder>
      >({
        token: context.token,
        path: `/me/mailFolders${query}`,
      });

      const folders = result.value ?? [];
      if (folders.length === 0) {
        return { content: "No mail folders found." };
      }

      const lines = folders.map(
        (f) =>
          `- ${f.displayName} (ID: ${f.id}) | Total: ${f.totalItemCount} | Unread: ${f.unreadItemCount}`,
      );

      return {
        content: `Mail folders (${folders.length}):\n${lines.join("\n")}`,
      };
    },
  };
}
