/**
 * Integration test: Agent Flow
 *
 * Tests the full agent loop end-to-end:
 *   user message -> Anthropic API call -> tool execution -> Graph API call -> response
 *
 * Uses real service modules, real registry, real runtime —
 * but mocks the Anthropic SDK and Graph API client.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Graph client BEFORE importing anything that uses it
// ---------------------------------------------------------------------------
vi.mock("../../src/graph/client.js", () => ({
  graphRequest: vi.fn(),
  graphPaginate: vi.fn(),
  graphBatch: vi.fn(),
  GraphApiError: class GraphApiError extends Error {
    path: string;
    status: number;
    body: string;
    code?: string;
    constructor(path: string, status: number, body: string, code?: string) {
      super(`Graph API ${path} failed (${status}): ${body.slice(0, 200)}`);
      this.name = "GraphApiError";
      this.path = path;
      this.status = status;
      this.body = body;
      this.code = code;
    }
    get isThrottled() { return this.status === 429; }
    get isNotFound() { return this.status === 404; }
    get isUnauthorized() { return this.status === 401; }
    get isForbidden() { return this.status === 403; }
  },
}));

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ---------------------------------------------------------------------------
// Now import modules under test (after mocks are set up)
// ---------------------------------------------------------------------------
import { graphRequest, graphPaginate } from "../../src/graph/client.js";
import { mailModule } from "../../src/services/mail/module.js";
import { calendarModule } from "../../src/services/calendar/module.js";
import { todoModule } from "../../src/services/todo/module.js";
import { teamsChatModule } from "../../src/services/teams-chat/module.js";
import { ServiceRegistry } from "../../src/services/registry.js";
import { runAgent } from "../../src/agents/runtime.js";
import { AgentSession } from "../../src/agents/session.js";
import { buildSystemPrompt } from "../../src/agents/prompt-builder.js";
import { collectTools } from "../../src/agents/tool-registry.js";
import type { ServicesConfig } from "../../src/config/types.services.js";
import type { ModelConfig } from "../../src/agents/model-config.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ALL_ENABLED: ServicesConfig = {
  mail: { enabled: true },
  calendar: { enabled: true },
  todo: { enabled: true },
  "teams-chat": { enabled: true },
};

const MODEL_CONFIG: ModelConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250514",
  apiKey: "sk-test-key",
  maxTokens: 4096,
};

const TOOL_CONTEXT = {
  token: "graph-test-token",
  userId: "user-123",
  timezone: "America/Chicago",
};

function buildRegistry(): ServiceRegistry {
  const registry = new ServiceRegistry();
  registry.register(mailModule);
  registry.register(calendarModule);
  registry.register(todoModule);
  registry.register(teamsChatModule);
  return registry;
}

function buildFullAgentParams(overrides?: Record<string, unknown>) {
  const registry = buildRegistry();

  const tools = collectTools({
    registry,
    servicesConfig: ALL_ENABLED,
    profile: "full",
  });

  const enabled = registry.getEnabled(ALL_ENABLED);
  const systemPrompt = buildSystemPrompt({
    identity: { name: "Clippy", emoji: "\uD83D\uDCCE" },
    services: enabled,
    userInfo: { displayName: "Bryan", email: "bryan@test.com" },
    timezone: "America/Chicago",
  });

  return {
    session: new AgentSession(),
    modelConfig: MODEL_CONFIG,
    tools,
    systemPrompt,
    toolContext: TOOL_CONTEXT,
    ...overrides,
  };
}

const mockGraphRequest = vi.mocked(graphRequest);
const mockGraphPaginate = vi.mocked(graphPaginate);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent flow (integration)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockGraphRequest.mockReset();
    mockGraphPaginate.mockReset();
  });

  // -------------------------------------------------------------------------
  // Simple text response (no tools)
  // -------------------------------------------------------------------------
  it("handles a simple text response (no tools)", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Hello Bryan! How can I help you with your Microsoft 365 today?" },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Hello!",
      ...params,
    });

    expect(result).toContain("Hello Bryan");
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Verify session state
    expect(params.session.messages).toHaveLength(2);
    expect(params.session.messages[0].role).toBe("user");
    expect(params.session.messages[0].content).toBe("Hello!");
    expect(params.session.messages[1].role).toBe("assistant");

    // Verify the system prompt was passed to Anthropic
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toContain("Clippy");
    expect(callArgs.system).toContain("Bryan");
  });

  // -------------------------------------------------------------------------
  // mail_list tool when asked about emails
  // -------------------------------------------------------------------------
  it("uses mail_list tool when asked about emails", async () => {
    // First call: Anthropic says use mail_list
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Let me check your inbox." },
        {
          type: "tool_use",
          id: "toolu_mail_1",
          name: "mail_list",
          input: { top: 5 },
        },
      ],
      stop_reason: "tool_use",
    });

    // Mock Graph API response for mail_list
    mockGraphRequest.mockResolvedValueOnce({
      value: [
        {
          id: "msg-aaa",
          subject: "Weekly standup notes",
          bodyPreview: "Here are the notes from today's standup...",
          from: { emailAddress: { name: "Alice Smith", address: "alice@example.com" } },
          toRecipients: [{ emailAddress: { name: "Bryan", address: "bryan@test.com" } }],
          receivedDateTime: "2025-01-15T10:30:00Z",
          isRead: false,
          hasAttachments: false,
          importance: "normal",
          isDraft: false,
          flag: { flagStatus: "notFlagged" },
        },
        {
          id: "msg-bbb",
          subject: "Project update",
          bodyPreview: "The new feature is ready for review.",
          from: { emailAddress: { name: "Bob Jones", address: "bob@example.com" } },
          toRecipients: [{ emailAddress: { name: "Bryan", address: "bryan@test.com" } }],
          receivedDateTime: "2025-01-15T09:00:00Z",
          isRead: true,
          hasAttachments: true,
          importance: "high",
          isDraft: false,
          flag: { flagStatus: "flagged" },
        },
      ],
    });

    // Second call: Anthropic summarizes
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "You have 2 recent emails:\n1. **Weekly standup notes** from Alice Smith (unread)\n2. **Project update** from Bob Jones (read, flagged)",
        },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Show me my latest emails",
      ...params,
    });

    // Verify response
    expect(result).toContain("2 recent emails");
    expect(result).toContain("Weekly standup notes");

    // Verify Graph API was called with correct path
    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
    const graphCall = mockGraphRequest.mock.calls[0][0];
    expect(graphCall.token).toBe("graph-test-token");
    expect(graphCall.path).toContain("/me/messages");

    // Verify Anthropic was called twice (tool_use + final)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // Verify session has the full conversation
    // user message + assistant (tool_use) + user (tool_result) + assistant (text)
    expect(params.session.messages).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // calendar_list when asked about schedule
  // -------------------------------------------------------------------------
  it("uses calendar_list when asked about schedule", async () => {
    // First call: Anthropic says use calendar_list
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_cal_1",
          name: "calendar_list",
          input: { days: 1 },
        },
      ],
      stop_reason: "tool_use",
    });

    // calendar_list uses graphPaginate, not graphRequest
    mockGraphPaginate.mockResolvedValueOnce([
      {
        id: "evt-1",
        subject: "Team standup",
        start: { dateTime: "2025-01-15T09:00:00", timeZone: "America/Chicago" },
        end: { dateTime: "2025-01-15T09:30:00", timeZone: "America/Chicago" },
        location: { displayName: "Teams" },
        isAllDay: false,
        organizer: {
          emailAddress: { name: "Alice Smith", address: "alice@example.com" },
        },
      },
      {
        id: "evt-2",
        subject: "Lunch with client",
        start: { dateTime: "2025-01-15T12:00:00", timeZone: "America/Chicago" },
        end: { dateTime: "2025-01-15T13:00:00", timeZone: "America/Chicago" },
        location: { displayName: "Downtown Cafe" },
        isAllDay: false,
        organizer: {
          emailAddress: { name: "Bryan", address: "bryan@test.com" },
        },
      },
    ]);

    // Second call: Anthropic summarizes
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "You have 2 events today:\n1. Team standup (9:00-9:30 AM) on Teams\n2. Lunch with client (12:00-1:00 PM) at Downtown Cafe",
        },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "What's on my calendar today?",
      ...params,
    });

    expect(result).toContain("2 events today");
    expect(result).toContain("Team standup");
    expect(result).toContain("Lunch with client");

    // calendar_list uses graphPaginate
    expect(mockGraphPaginate).toHaveBeenCalledTimes(1);
    const graphCall = mockGraphPaginate.mock.calls[0][0];
    expect(graphCall.token).toBe("graph-test-token");
    expect(graphCall.path).toContain("calendarView");
  });

  // -------------------------------------------------------------------------
  // todo_create when asked to add a task
  // -------------------------------------------------------------------------
  it("uses todo_create when asked to add a task", async () => {
    // First call: Anthropic says use todo_create
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_todo_1",
          name: "todo_create",
          input: {
            listId: "list-default",
            title: "Buy groceries",
            dueDateTime: "2025-01-20",
            importance: "normal",
          },
        },
      ],
      stop_reason: "tool_use",
    });

    // Mock Graph API POST response for task creation
    mockGraphRequest.mockResolvedValueOnce({
      id: "task-new-123",
      title: "Buy groceries",
      status: "notStarted",
      importance: "normal",
      dueDateTime: {
        dateTime: "2025-01-20T00:00:00",
        timeZone: "America/Chicago",
      },
    });

    // Second call: Anthropic confirms
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: 'I\'ve created the task "Buy groceries" due January 20, 2025.',
        },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Add a task to buy groceries, due January 20",
      ...params,
    });

    expect(result).toContain("Buy groceries");
    expect(result).toContain("January 20");

    // Verify Graph API was called with POST method
    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
    const graphCall = mockGraphRequest.mock.calls[0][0];
    expect(graphCall.token).toBe("graph-test-token");
    expect(graphCall.path).toContain("/me/todo/lists/list-default/tasks");
    expect(graphCall.method).toBe("POST");
    expect(graphCall.body).toMatchObject({
      title: "Buy groceries",
    });
  });

  // -------------------------------------------------------------------------
  // Tool execution errors are handled gracefully
  // -------------------------------------------------------------------------
  it("handles tool execution errors gracefully (Graph API error)", async () => {
    // First call: Anthropic says use mail_list
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_err_1",
          name: "mail_list",
          input: { top: 5 },
        },
      ],
      stop_reason: "tool_use",
    });

    // Mock Graph API throws an error
    const { GraphApiError } = await import("../../src/graph/client.js");
    mockGraphRequest.mockRejectedValueOnce(
      new GraphApiError("/me/messages", 403, '{"error":{"code":"ErrorAccessDenied","message":"Access denied"}}', "ErrorAccessDenied"),
    );

    // Second call: Anthropic reports the error
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I encountered an access denied error when trying to read your emails. Please check that your account has the required Mail.Read permission.",
        },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Show my emails",
      ...params,
    });

    expect(result).toContain("access denied");

    // Verify the error was passed back to Anthropic as a tool_result
    const secondCallArgs = mockCreate.mock.calls[1][0];
    const messages = secondCallArgs.messages;
    const toolResultMessage = messages[messages.length - 1];
    expect(toolResultMessage.role).toBe("user");
    // The tool result should contain the error info
    const toolResultContent = toolResultMessage.content;
    expect(Array.isArray(toolResultContent)).toBe(true);
    expect(toolResultContent[0].type).toBe("tool_result");
    expect(toolResultContent[0].is_error).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Multi-turn tool calls: list emails then read one
  // -------------------------------------------------------------------------
  it("handles multi-turn tool calls (list then read)", async () => {
    // Turn 1: Anthropic says list emails
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Let me find your latest email." },
        {
          type: "tool_use",
          id: "toolu_multi_1",
          name: "mail_list",
          input: { top: 1 },
        },
      ],
      stop_reason: "tool_use",
    });

    // Graph response for mail_list
    mockGraphRequest.mockResolvedValueOnce({
      value: [
        {
          id: "msg-latest",
          subject: "Important update",
          bodyPreview: "Please review the attached document...",
          from: { emailAddress: { name: "CEO", address: "ceo@company.com" } },
          toRecipients: [{ emailAddress: { name: "Bryan", address: "bryan@test.com" } }],
          receivedDateTime: "2025-01-15T14:00:00Z",
          isRead: false,
          hasAttachments: true,
          importance: "high",
          isDraft: false,
          flag: { flagStatus: "notFlagged" },
        },
      ],
    });

    // Turn 2: Anthropic reads the specific email
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_multi_2",
          name: "mail_read",
          input: { messageId: "msg-latest" },
        },
      ],
      stop_reason: "tool_use",
    });

    // Graph response for mail_read
    mockGraphRequest.mockResolvedValueOnce({
      id: "msg-latest",
      subject: "Important update",
      body: { content: "Please review the attached document and provide feedback by EOD.", contentType: "text" },
      from: { emailAddress: { name: "CEO", address: "ceo@company.com" } },
      toRecipients: [{ emailAddress: { name: "Bryan", address: "bryan@test.com" } }],
      receivedDateTime: "2025-01-15T14:00:00Z",
      isRead: false,
      hasAttachments: true,
      importance: "high",
    });

    // Turn 3: Anthropic gives final summary
    mockCreate.mockResolvedValueOnce({
      id: "msg_3",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Your latest email is from the CEO about an important update. They're asking you to review an attached document and provide feedback by end of day.",
        },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Read my latest email",
      ...params,
    });

    expect(result).toContain("CEO");
    expect(result).toContain("review");
    expect(result).toContain("feedback");

    // 3 Anthropic calls
    expect(mockCreate).toHaveBeenCalledTimes(3);
    // 2 Graph calls (list + read)
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // teams_send tool with real module
  // -------------------------------------------------------------------------
  it("uses teams_send to send a Teams message", async () => {
    // First call: Anthropic says use teams_send
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_teams_1",
          name: "teams_send",
          input: {
            chatId: "chat-abc",
            content: "Hello team! The deployment is complete.",
          },
        },
      ],
      stop_reason: "tool_use",
    });

    // Mock Graph API POST response for sending chat message
    mockGraphRequest.mockResolvedValueOnce({
      id: "chat-msg-new",
      body: { content: "Hello team! The deployment is complete.", contentType: "text" },
      from: { user: { displayName: "Bryan" } },
      createdDateTime: "2025-01-15T15:00:00Z",
    });

    // Second call: Anthropic confirms
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I've sent the message to the team chat.",
        },
      ],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Send a message to the team chat saying the deployment is complete",
      ...params,
    });

    expect(result).toContain("sent the message");

    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
    const graphCall = mockGraphRequest.mock.calls[0][0];
    expect(graphCall.path).toContain("/me/chats/chat-abc/messages");
    expect(graphCall.method).toBe("POST");
  });

  // -------------------------------------------------------------------------
  // System prompt includes all services and tools are passed
  // -------------------------------------------------------------------------
  it("passes system prompt with all services and tools to Anthropic", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Ready to help!" }],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    await runAgent({
      message: "Hi",
      ...params,
    });

    const callArgs = mockCreate.mock.calls[0][0];

    // System prompt should contain all service references
    expect(callArgs.system).toContain("Outlook Mail");
    expect(callArgs.system).toContain("Outlook Calendar");
    expect(callArgs.system).toContain("To Do");
    expect(callArgs.system).toContain("Teams Chat");
    expect(callArgs.system).toContain("Bryan");

    // Tools should be passed (31 total with full profile)
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.tools.length).toBe(31);

    // Spot-check tool schema format
    const mailList = callArgs.tools.find(
      (t: { name: string }) => t.name === "mail_list",
    );
    expect(mailList).toBeDefined();
    expect(mailList.description).toBeTruthy();
    expect(mailList.input_schema).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // read-only profile prevents write tools from being available
  // -------------------------------------------------------------------------
  it("read-only profile prevents write tools from being available", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "I can only read your data." }],
      stop_reason: "end_turn",
    });

    const registry = buildRegistry();
    const tools = collectTools({
      registry,
      servicesConfig: ALL_ENABLED,
      profile: "read-only",
    });

    const enabled = registry.getEnabled(ALL_ENABLED);
    const systemPrompt = buildSystemPrompt({
      identity: { name: "Clippy" },
      services: enabled,
    });

    const session = new AgentSession();
    await runAgent({
      message: "Send an email",
      session,
      modelConfig: MODEL_CONFIG,
      tools,
      systemPrompt,
      toolContext: TOOL_CONTEXT,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name);

    // Write tools should NOT be in the list
    expect(toolNames).not.toContain("mail_send");
    expect(toolNames).not.toContain("calendar_create");
    expect(toolNames).not.toContain("todo_create");
    expect(toolNames).not.toContain("teams_send");

    // Read tools with standard suffixes should be present
    expect(toolNames).toContain("mail_list");
    expect(toolNames).toContain("calendar_list");
    expect(toolNames).toContain("todo_lists");

    // Teams tools have non-standard suffixes (e.g. _chats, _chat)
    // that don't match the read-only allowed patterns, so they are filtered out
    expect(toolNames).not.toContain("teams_list_chats");
  });

  // -------------------------------------------------------------------------
  // maxTurns safety limit works in full integration
  // -------------------------------------------------------------------------
  it("respects maxTurns safety limit", async () => {
    // Always return tool_use to trigger the limit
    mockCreate.mockResolvedValue({
      id: "msg_loop",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_loop",
          name: "mail_list",
          input: { top: 5 },
        },
      ],
      stop_reason: "tool_use",
    });

    // Graph always succeeds
    mockGraphRequest.mockResolvedValue({
      value: [
        {
          id: "msg-x",
          subject: "Test",
          bodyPreview: "...",
          from: { emailAddress: { name: "X", address: "x@test.com" } },
          toRecipients: [],
          receivedDateTime: "2025-01-15T10:00:00Z",
          isRead: true,
          hasAttachments: false,
          importance: "normal",
          isDraft: false,
          flag: { flagStatus: "notFlagged" },
        },
      ],
    });

    const params = buildFullAgentParams();
    const result = await runAgent({
      message: "Keep checking emails",
      maxTurns: 3,
      ...params,
    });

    expect(result).toContain("maximum number of tool-calling turns");
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // onToolCall callback fires with real tool names
  // -------------------------------------------------------------------------
  it("fires onToolCall callback with real tool names", async () => {
    const toolCallLog: Array<{ name: string; input: unknown }> = [];

    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_cb_1",
          name: "todo_lists",
          input: {},
        },
      ],
      stop_reason: "tool_use",
    });

    mockGraphRequest.mockResolvedValueOnce({
      value: [
        { id: "list-1", displayName: "Tasks", isOwner: true, wellknownListName: "defaultList" },
      ],
    });

    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "You have 1 task list: Tasks" }],
      stop_reason: "end_turn",
    });

    const params = buildFullAgentParams();
    await runAgent({
      message: "Show my to-do lists",
      onToolCall: (name, input) => {
        toolCallLog.push({ name, input });
      },
      ...params,
    });

    expect(toolCallLog).toHaveLength(1);
    expect(toolCallLog[0].name).toBe("todo_lists");
  });
});
