import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mailListTool,
  mailReadTool,
  mailSearchTool,
  mailSendTool,
  mailDraftTool,
  mailReplyTool,
  mailForwardTool,
  mailMoveTool,
  mailFlagTool,
  mailDeleteTool,
  mailFoldersTool,
} from "./tools.js";
import { mailModule } from "./module.js";
import type { ToolContext } from "../types.js";
import type { GraphMessage, GraphMailFolder } from "./types.js";

// ---------------------------------------------------------------------------
// Mock the Graph client
// ---------------------------------------------------------------------------

vi.mock("../../graph/client.js", () => ({
  graphRequest: vi.fn(),
  graphPaginate: vi.fn(),
  GraphApiError: class GraphApiError extends Error {
    constructor(
      public readonly path: string,
      public readonly status: number,
      public readonly body: string,
      public readonly code?: string,
    ) {
      super(`Graph API ${path} failed (${status}): ${body.slice(0, 200)}`);
      this.name = "GraphApiError";
    }
    get isThrottled() {
      return this.status === 429;
    }
    get isNotFound() {
      return this.status === 404;
    }
    get isUnauthorized() {
      return this.status === 401;
    }
    get isForbidden() {
      return this.status === 403;
    }
  },
}));

import { graphRequest } from "../../graph/client.js";

const mockGraphRequest = vi.mocked(graphRequest);

const ctx: ToolContext = { token: "test-token-abc" };

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function sampleMessage(overrides?: Partial<GraphMessage>): GraphMessage {
  return {
    id: "msg-1",
    subject: "Hello World",
    bodyPreview: "This is a test email body preview.",
    from: { emailAddress: { address: "alice@example.com", name: "Alice" } },
    toRecipients: [
      { emailAddress: { address: "bob@example.com", name: "Bob" } },
    ],
    receivedDateTime: "2025-03-15T10:30:00Z",
    hasAttachments: false,
    importance: "normal",
    isRead: false,
    isDraft: false,
    ...overrides,
  };
}

function sampleFolder(overrides?: Partial<GraphMailFolder>): GraphMailFolder {
  return {
    id: "folder-1",
    displayName: "Inbox",
    childFolderCount: 2,
    totalItemCount: 42,
    unreadItemCount: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mail_list
// ---------------------------------------------------------------------------

describe("mail_list", () => {
  const tool = mailListTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists messages from inbox with defaults", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleMessage(), sampleMessage({ id: "msg-2", subject: "Second" })],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Found 2 message(s)");
    expect(result.content).toContain("Hello World");
    expect(result.content).toContain("Second");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token-abc",
        path: expect.stringContaining("/me/messages"),
      }),
    );
  });

  it("uses the specified folder", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ folderId: "custom-folder-id" }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/me/mailFolders/custom-folder-id/messages"),
      }),
    );
  });

  it("clamps top to max 50", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ top: 100 }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$top=50"),
      }),
    );
  });

  it("returns empty message when no results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);
    expect(result.content).toBe("No messages found.");
  });

  it("passes OData filter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ filter: "isRead eq false" }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$filter="),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// mail_read
// ---------------------------------------------------------------------------

describe("mail_read", () => {
  const tool = mailReadTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a message by ID", async () => {
    mockGraphRequest.mockResolvedValue(
      sampleMessage({
        body: { contentType: "text", content: "Full email body text" },
        ccRecipients: [
          { emailAddress: { address: "carol@example.com", name: "Carol" } },
        ],
      }),
    );

    const result = await tool.execute({ messageId: "msg-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Subject: Hello World");
    expect(result.content).toContain("From: Alice <alice@example.com>");
    expect(result.content).toContain("Full email body text");
    expect(result.content).toContain("Carol <carol@example.com>");
  });

  it("returns error when messageId is missing", async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("messageId is required");
  });
});

// ---------------------------------------------------------------------------
// mail_search
// ---------------------------------------------------------------------------

describe("mail_search", () => {
  const tool = mailSearchTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches messages with $search parameter", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleMessage({ subject: "Budget Report" })],
    });

    const result = await tool.execute({ query: "budget" }, ctx);

    expect(result.content).toContain('Found 1 result(s) for "budget"');
    expect(result.content).toContain("Budget Report");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$search="),
      }),
    );
  });

  it("returns error when query is missing", async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("query is required");
  });

  it("returns not-found message for empty results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ query: "nonexistent" }, ctx);
    expect(result.content).toContain('No messages found matching "nonexistent"');
  });

  it("clamps top to max 25", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ query: "test", top: 50 }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$top=25"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// mail_send
// ---------------------------------------------------------------------------

describe("mail_send", () => {
  const tool = mailSendTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an email with required fields", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        to: "bob@example.com",
        subject: "Test Email",
        body: "Hello Bob!",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Email sent successfully");
    expect(result.content).toContain("bob@example.com");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/sendMail",
        body: expect.objectContaining({
          message: expect.objectContaining({
            subject: "Test Email",
            body: { contentType: "text", content: "Hello Bob!" },
            toRecipients: [
              { emailAddress: { address: "bob@example.com" } },
            ],
          }),
          saveToSentItems: true,
        }),
      }),
    );
  });

  it("sends email with CC and HTML content", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        to: "bob@example.com",
        cc: "carol@example.com",
        subject: "HTML Email",
        body: "<h1>Hello</h1>",
        contentType: "html",
        importance: "high",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          message: expect.objectContaining({
            body: { contentType: "html", content: "<h1>Hello</h1>" },
            ccRecipients: [
              { emailAddress: { address: "carol@example.com" } },
            ],
            importance: "high",
          }),
        }),
      }),
    );
  });

  it("handles multiple comma-separated recipients", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        to: "bob@example.com, carol@example.com",
        subject: "Group",
        body: "Hi all",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("bob@example.com");
    expect(result.content).toContain("carol@example.com");
  });

  it("returns error when to is missing", async () => {
    const result = await tool.execute({ subject: "X", body: "Y" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("recipient");
  });

  it("returns error when subject is missing", async () => {
    const result = await tool.execute(
      { to: "bob@example.com", body: "Y" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("subject is required");
  });

  it("returns error when body is missing", async () => {
    const result = await tool.execute(
      { to: "bob@example.com", subject: "X" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("body is required");
  });
});

// ---------------------------------------------------------------------------
// mail_draft
// ---------------------------------------------------------------------------

describe("mail_draft", () => {
  const tool = mailDraftTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a draft message", async () => {
    mockGraphRequest.mockResolvedValue({
      id: "draft-1",
      subject: "Draft Subject",
    });

    const result = await tool.execute(
      { subject: "Draft Subject", body: "Draft body", to: "bob@example.com" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Draft created");
    expect(result.content).toContain("draft-1");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/messages",
        body: expect.objectContaining({
          subject: "Draft Subject",
          isDraft: true,
        }),
      }),
    );
  });

  it("creates draft without recipients", async () => {
    mockGraphRequest.mockResolvedValue({
      id: "draft-2",
      subject: "No Recipient",
    });

    const result = await tool.execute(
      { subject: "No Recipient", body: "Just a note" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Draft created");
  });

  it("returns error when subject is missing", async () => {
    const result = await tool.execute({ body: "body" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("subject is required");
  });
});

// ---------------------------------------------------------------------------
// mail_reply
// ---------------------------------------------------------------------------

describe("mail_reply", () => {
  const tool = mailReplyTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replies to a message", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      { messageId: "msg-1", comment: "Thanks!" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Reply sent");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/messages/msg-1/reply",
        body: { comment: "Thanks!" },
      }),
    );
  });

  it("returns error when messageId is missing", async () => {
    const result = await tool.execute({ comment: "Hello" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("messageId is required");
  });

  it("returns error when comment is missing", async () => {
    const result = await tool.execute({ messageId: "msg-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("comment is required");
  });
});

// ---------------------------------------------------------------------------
// mail_forward
// ---------------------------------------------------------------------------

describe("mail_forward", () => {
  const tool = mailForwardTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards a message", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      { messageId: "msg-1", to: "carol@example.com", comment: "FYI" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("forwarded");
    expect(result.content).toContain("carol@example.com");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/messages/msg-1/forward",
        body: expect.objectContaining({
          toRecipients: [
            { emailAddress: { address: "carol@example.com" } },
          ],
          comment: "FYI",
        }),
      }),
    );
  });

  it("forwards without a comment", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      { messageId: "msg-1", to: "carol@example.com" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { toRecipients: [{ emailAddress: { address: "carol@example.com" } }] },
      }),
    );
  });

  it("returns error when messageId is missing", async () => {
    const result = await tool.execute({ to: "carol@example.com" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error when to is missing", async () => {
    const result = await tool.execute({ messageId: "msg-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("recipient");
  });
});

// ---------------------------------------------------------------------------
// mail_move
// ---------------------------------------------------------------------------

describe("mail_move", () => {
  const tool = mailMoveTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves a message to a different folder", async () => {
    mockGraphRequest.mockResolvedValue({ id: "msg-1-moved" });

    const result = await tool.execute(
      { messageId: "msg-1", destinationId: "archive" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("moved successfully");
    expect(result.content).toContain("msg-1-moved");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/messages/msg-1/move",
        body: { destinationId: "archive" },
      }),
    );
  });

  it("returns error when messageId is missing", async () => {
    const result = await tool.execute({ destinationId: "archive" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error when destinationId is missing", async () => {
    const result = await tool.execute({ messageId: "msg-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("destinationId is required");
  });
});

// ---------------------------------------------------------------------------
// mail_flag
// ---------------------------------------------------------------------------

describe("mail_flag", () => {
  const tool = mailFlagTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags a message (default)", async () => {
    mockGraphRequest.mockResolvedValue({ id: "msg-1" });

    const result = await tool.execute({ messageId: "msg-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("flagged");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        path: "/me/messages/msg-1",
        body: { flag: { flagStatus: "flagged" } },
      }),
    );
  });

  it("flags a message when flagged=true", async () => {
    mockGraphRequest.mockResolvedValue({ id: "msg-1" });

    const result = await tool.execute(
      { messageId: "msg-1", flagged: true },
      ctx,
    );

    expect(result.content).toContain("flagged successfully");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { flag: { flagStatus: "flagged" } },
      }),
    );
  });

  it("unflags a message when flagged=false", async () => {
    mockGraphRequest.mockResolvedValue({ id: "msg-1" });

    const result = await tool.execute(
      { messageId: "msg-1", flagged: false },
      ctx,
    );

    expect(result.content).toContain("unflagged");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { flag: { flagStatus: "notFlagged" } },
      }),
    );
  });

  it("returns error when messageId is missing", async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mail_delete
// ---------------------------------------------------------------------------

describe("mail_delete", () => {
  const tool = mailDeleteTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a message", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({ messageId: "msg-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("deleted");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/me/messages/msg-1",
      }),
    );
  });

  it("returns error when messageId is missing", async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("messageId is required");
  });
});

// ---------------------------------------------------------------------------
// mail_folders
// ---------------------------------------------------------------------------

describe("mail_folders", () => {
  const tool = mailFoldersTool();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists mail folders", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [
        sampleFolder(),
        sampleFolder({
          id: "folder-2",
          displayName: "Sent Items",
          totalItemCount: 100,
          unreadItemCount: 0,
        }),
      ],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Mail folders (2)");
    expect(result.content).toContain("Inbox");
    expect(result.content).toContain("Sent Items");
    expect(result.content).toContain("Unread: 5");
  });

  it("returns message when no folders found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);
    expect(result.content).toBe("No mail folders found.");
  });

  it("passes top parameter to query", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ top: 10 }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$top=10"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// mailModule
// ---------------------------------------------------------------------------

describe("mailModule", () => {
  it("has correct id and meta", () => {
    expect(mailModule.id).toBe("mail");
    expect(mailModule.meta.label).toBe("Outlook Mail");
    expect(mailModule.meta.requiredScopes).toContain("Mail.Read");
  });

  it("exposes 11 tools", () => {
    const tools = mailModule.tools();
    expect(tools).toHaveLength(11);
    const names = tools.map((t) => t.name);
    expect(names).toContain("mail_list");
    expect(names).toContain("mail_read");
    expect(names).toContain("mail_search");
    expect(names).toContain("mail_send");
    expect(names).toContain("mail_draft");
    expect(names).toContain("mail_reply");
    expect(names).toContain("mail_forward");
    expect(names).toContain("mail_move");
    expect(names).toContain("mail_flag");
    expect(names).toContain("mail_delete");
    expect(names).toContain("mail_folders");
  });

  it("has correct capabilities", () => {
    expect(mailModule.capabilities).toEqual({
      read: true,
      write: true,
      delete: true,
      search: true,
      subscribe: true,
    });
  });

  it("probe returns ok on success", async () => {
    mockGraphRequest.mockResolvedValue({ value: [{ id: "msg-1" }] });

    const result = await mailModule.status!.probe({ token: "test-token" });
    expect(result.ok).toBe(true);
  });

  it("probe returns error on failure", async () => {
    mockGraphRequest.mockRejectedValue(new Error("Unauthorized"));

    const result = await mailModule.status!.probe({ token: "bad-token" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unauthorized");
  });

  it("has subscription config", () => {
    expect(mailModule.subscriptions).toBeDefined();
    expect(mailModule.subscriptions!.resources).toContain("/me/messages");
    expect(mailModule.subscriptions!.changeTypes).toContain("created");
  });

  it("provides prompt hints", () => {
    const hints = mailModule.promptHints!();
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("Outlook Mail");
  });
});

// ---------------------------------------------------------------------------
// Error handling (Graph API errors propagate)
// ---------------------------------------------------------------------------

describe("Graph API error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates graph errors from tools", async () => {
    const { GraphApiError } = await import("../../graph/client.js");
    mockGraphRequest.mockRejectedValue(
      new GraphApiError("/me/messages", 401, "Unauthorized", "InvalidAuthenticationToken"),
    );

    await expect(mailListTool().execute({}, ctx)).rejects.toThrow("Graph API");
  });
});
