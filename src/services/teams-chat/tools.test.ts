import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { TeamsChat, TeamsChatMessage, TeamsChannel } from "./types.js";
import {
  teamsListChatsTool,
  teamsReadChatTool,
  teamsSendTool,
  teamsListChannelsTool,
  teamsChannelMessagesTool,
  teamsSendChannelTool,
} from "./tools.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

vi.mock("../../graph/client.js", () => ({
  graphRequest: vi.fn(),
}));

import { graphRequest } from "../../graph/client.js";
const mockGraphRequest = vi.mocked(graphRequest);

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ctx = createToolContext({ token: "test-token-abc" });

function chatFixture(overrides?: Partial<TeamsChat>): TeamsChat {
  return {
    id: "chat-1",
    topic: "Project Alpha",
    chatType: "group",
    createdDateTime: "2025-06-01T10:00:00Z",
    ...overrides,
  };
}

function messageFixture(overrides?: Partial<TeamsChatMessage>): TeamsChatMessage {
  return {
    id: "msg-1",
    body: { content: "Hello team!", contentType: "text" },
    from: { user: { id: "user-1", displayName: "Alice Johnson" } },
    createdDateTime: "2025-06-01T12:30:00Z",
    messageType: "message",
    ...overrides,
  };
}

function channelFixture(overrides?: Partial<TeamsChannel>): TeamsChannel {
  return {
    id: "channel-1",
    displayName: "General",
    description: "General channel",
    membershipType: "standard",
    ...overrides,
  };
}

function collectionResponse<T>(value: T[]): GraphCollectionResponse<T> {
  return { value };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("teams_list_chats", () => {
  const tool = teamsListChatsTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("teams_list_chats");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
  });

  it("lists user chats", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        chatFixture(),
        chatFixture({ id: "chat-2", topic: null, chatType: "oneOnOne" }),
      ]),
    );

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Project Alpha");
    expect(result.content).toContain("chat-1");
    expect(result.content).toContain("1:1 chat");
    expect(result.content).toContain("chat-2");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token-abc",
        path: expect.stringContaining("/me/chats"),
      }),
    );
  });

  it("returns message when no chats found", async () => {
    mockGraphRequest.mockResolvedValueOnce(collectionResponse([]));

    const result = await tool.execute({}, ctx);
    expect(result.content).toBe("No chats found.");
  });

  it("respects top parameter capped at 50", async () => {
    mockGraphRequest.mockResolvedValueOnce(collectionResponse([chatFixture()]));

    await tool.execute({ top: 100 }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("$top=50"),
      }),
    );
  });

  it("labels meeting chats correctly", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        chatFixture({ id: "chat-m", topic: null, chatType: "meeting" }),
      ]),
    );

    const result = await tool.execute({}, ctx);
    expect(result.content).toContain("Meeting chat");
  });
});

describe("teams_read_chat", () => {
  const tool = teamsReadChatTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("teams_read_chat");
    expect(tool.inputSchema).toHaveProperty("required");
  });

  it("reads messages from a chat", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        messageFixture(),
        messageFixture({
          id: "msg-2",
          body: { content: "Sounds good!", contentType: "text" },
          from: { user: { id: "user-2", displayName: "Bob Smith" } },
          createdDateTime: "2025-06-01T12:31:00Z",
        }),
      ]),
    );

    const result = await tool.execute({ chatId: "chat-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Alice Johnson");
    expect(result.content).toContain("Hello team!");
    expect(result.content).toContain("Bob Smith");
    expect(result.content).toContain("Sounds good!");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/me/chats/chat-1/messages"),
      }),
    );
  });

  it("returns error when chatId missing", async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("chatId is required");
  });

  it("skips non-message types", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        messageFixture({ messageType: "systemEventMessage" }),
        messageFixture({ id: "msg-real", body: { content: "Real msg", contentType: "text" } }),
      ]),
    );

    const result = await tool.execute({ chatId: "chat-1" }, ctx);
    expect(result.content).toContain("Real msg");
    // systemEventMessage should be filtered out — only one line
    const lines = result.content.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("returns message when no messages found", async () => {
    mockGraphRequest.mockResolvedValueOnce(collectionResponse([]));

    const result = await tool.execute({ chatId: "chat-1" }, ctx);
    expect(result.content).toBe("No messages found in this chat.");
  });

  it("strips HTML tags from html messages", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        messageFixture({
          body: { content: "<p>Hello <b>world</b></p>", contentType: "html" },
        }),
      ]),
    );

    const result = await tool.execute({ chatId: "chat-1" }, ctx);
    expect(result.content).toContain("Hello world");
    expect(result.content).not.toContain("<p>");
    expect(result.content).not.toContain("<b>");
  });

  it("handles application sender", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        messageFixture({
          from: { application: { id: "app-1", displayName: "Bot" } },
        }),
      ]),
    );

    const result = await tool.execute({ chatId: "chat-1" }, ctx);
    expect(result.content).toContain("[App] Bot");
  });

  it("handles null from field", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        messageFixture({ from: null }),
      ]),
    );

    const result = await tool.execute({ chatId: "chat-1" }, ctx);
    expect(result.content).toContain("(unknown)");
  });
});

describe("teams_send", () => {
  const tool = teamsSendTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("teams_send");
    expect(tool.inputSchema).toHaveProperty("required");
  });

  it("sends a message to a chat", async () => {
    mockGraphRequest.mockResolvedValueOnce({ id: "new-msg-1" });

    const result = await tool.execute({ chatId: "chat-1", content: "Hi there!" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Message sent");
    expect(result.content).toContain("new-msg-1");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token-abc",
        path: "/me/chats/chat-1/messages",
        method: "POST",
        body: { body: { content: "Hi there!", contentType: "text" } },
      }),
    );
  });

  it("returns error when chatId missing", async () => {
    const result = await tool.execute({ content: "Hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("chatId is required");
  });

  it("returns error when content missing", async () => {
    const result = await tool.execute({ chatId: "chat-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("content is required");
  });
});

describe("teams_list_channels", () => {
  const tool = teamsListChannelsTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("teams_list_channels");
  });

  it("lists channels in a team", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        channelFixture(),
        channelFixture({
          id: "channel-2",
          displayName: "Dev",
          description: null,
          membershipType: "private",
        }),
      ]),
    );

    const result = await tool.execute({ teamId: "team-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("General");
    expect(result.content).toContain("channel-1");
    expect(result.content).toContain("Dev");
    expect(result.content).toContain("private");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/teams/team-1/channels",
      }),
    );
  });

  it("returns error when teamId missing", async () => {
    const result = await tool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("teamId is required");
  });

  it("returns message when no channels found", async () => {
    mockGraphRequest.mockResolvedValueOnce(collectionResponse([]));

    const result = await tool.execute({ teamId: "team-1" }, ctx);
    expect(result.content).toBe("No channels found.");
  });
});

describe("teams_channel_messages", () => {
  const tool = teamsChannelMessagesTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("teams_channel_messages");
    expect(tool.inputSchema).toHaveProperty("required");
  });

  it("reads messages from a channel", async () => {
    mockGraphRequest.mockResolvedValueOnce(
      collectionResponse([
        messageFixture(),
      ]),
    );

    const result = await tool.execute({ teamId: "team-1", channelId: "channel-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Alice Johnson");
    expect(result.content).toContain("Hello team!");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/teams/team-1/channels/channel-1/messages"),
      }),
    );
  });

  it("returns error when teamId missing", async () => {
    const result = await tool.execute({ channelId: "ch-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("teamId is required");
  });

  it("returns error when channelId missing", async () => {
    const result = await tool.execute({ teamId: "team-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("channelId is required");
  });

  it("returns message when no messages found", async () => {
    mockGraphRequest.mockResolvedValueOnce(collectionResponse([]));

    const result = await tool.execute({ teamId: "team-1", channelId: "ch-1" }, ctx);
    expect(result.content).toBe("No messages found in this channel.");
  });
});

describe("teams_send_channel", () => {
  const tool = teamsSendChannelTool();

  it("has correct metadata", () => {
    expect(tool.name).toBe("teams_send_channel");
  });

  it("sends a message to a channel", async () => {
    mockGraphRequest.mockResolvedValueOnce({ id: "ch-msg-1" });

    const result = await tool.execute(
      { teamId: "team-1", channelId: "channel-1", content: "Channel post!" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Message sent to channel");
    expect(result.content).toContain("ch-msg-1");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/teams/team-1/channels/channel-1/messages",
        method: "POST",
        body: { body: { content: "Channel post!", contentType: "text" } },
      }),
    );
  });

  it("returns error when teamId missing", async () => {
    const result = await tool.execute({ channelId: "ch-1", content: "Hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("teamId is required");
  });

  it("returns error when channelId missing", async () => {
    const result = await tool.execute({ teamId: "t-1", content: "Hi" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("channelId is required");
  });

  it("returns error when content missing", async () => {
    const result = await tool.execute({ teamId: "t-1", channelId: "ch-1" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("content is required");
  });
});

describe("teamsChatModule integration", () => {
  it("exposes all 6 tools from module", async () => {
    // Dynamic import to test the module wiring
    const { teamsChatModule } = await import("./module.js");
    const tools = teamsChatModule.tools();
    const names = tools.map((t) => t.name);

    expect(tools).toHaveLength(6);
    expect(names).toEqual([
      "teams_list_chats",
      "teams_read_chat",
      "teams_send",
      "teams_list_channels",
      "teams_channel_messages",
      "teams_send_channel",
    ]);
  });

  it("has correct module metadata", async () => {
    const { teamsChatModule } = await import("./module.js");

    expect(teamsChatModule.id).toBe("teams-chat");
    expect(teamsChatModule.meta.label).toBe("Teams Chat");
    expect(teamsChatModule.meta.requiredScopes).toContain("Chat.Read");
    expect(teamsChatModule.meta.requiredScopes).toContain("ChatMessage.Send");
    expect(teamsChatModule.meta.requiredScopes).toContain("Channel.ReadBasic.All");
    expect(teamsChatModule.meta.requiredScopes).toContain("ChannelMessage.Read.All");
    expect(teamsChatModule.meta.requiredScopes).toContain("ChannelMessage.Send");
    expect(teamsChatModule.capabilities.read).toBe(true);
    expect(teamsChatModule.capabilities.write).toBe(true);
    expect(teamsChatModule.capabilities.delete).toBe(false);
  });

  it("provides prompt hints", async () => {
    const { teamsChatModule } = await import("./module.js");

    const hints = teamsChatModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
