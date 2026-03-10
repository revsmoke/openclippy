import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentTool, ServiceModule } from "../services/types.js";
import type { ServicesConfig } from "../config/types.services.js";

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK before importing modules that use it
// ---------------------------------------------------------------------------
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

// Now import the modules under test (after mock setup)
import { resolveModelConfig } from "./model-config.js";
import { filterToolsByProfile } from "./tool-profiles.js";
import { collectTools } from "./tool-registry.js";
import { buildSystemPrompt } from "./prompt-builder.js";
import { AgentSession } from "./session.js";
import { runAgent } from "./runtime.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, overrides?: Partial<AgentTool>): AgentTool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: "object", properties: {} },
    execute: vi.fn().mockResolvedValue({ content: `result from ${name}` }),
    ...overrides,
  };
}

function makeModule(
  id: ServiceModule["id"],
  toolNames: string[],
  overrides?: Partial<ServiceModule>,
): ServiceModule {
  return {
    id,
    meta: {
      label: id.charAt(0).toUpperCase() + id.slice(1),
      description: `${id} service`,
      requiredScopes: [`${id}.Read`],
    },
    capabilities: {
      read: true,
      write: true,
      delete: true,
      search: true,
      subscribe: false,
    },
    tools: () => toolNames.map((n) => makeTool(n)),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. resolveModelConfig
// ---------------------------------------------------------------------------

describe("resolveModelConfig", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    // Restore env
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("uses config.apiKey when provided", () => {
    const config = resolveModelConfig({ apiKey: "sk-test-key" });
    expect(config.apiKey).toBe("sk-test-key");
    expect(config.provider).toBe("anthropic");
  });

  it("falls back to ANTHROPIC_API_KEY env var", () => {
    process.env.ANTHROPIC_API_KEY = "sk-env-key";
    const config = resolveModelConfig({});
    expect(config.apiKey).toBe("sk-env-key");
  });

  it("throws when no API key is available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveModelConfig({})).toThrow("Anthropic API key is required");
  });

  it("uses default model when none specified", () => {
    const config = resolveModelConfig({ apiKey: "sk-test" });
    expect(config.model).toBe("claude-sonnet-4-5-20250514");
  });

  it("respects custom model", () => {
    const config = resolveModelConfig({
      apiKey: "sk-test",
      model: "claude-opus-4-20250514",
    });
    expect(config.model).toBe("claude-opus-4-20250514");
  });

  it("sets default maxTokens to 4096", () => {
    const config = resolveModelConfig({ apiKey: "sk-test" });
    expect(config.maxTokens).toBe(4096);
  });

  it("prefers config.apiKey over env var", () => {
    process.env.ANTHROPIC_API_KEY = "sk-env";
    const config = resolveModelConfig({ apiKey: "sk-config" });
    expect(config.apiKey).toBe("sk-config");
  });
});

// ---------------------------------------------------------------------------
// 2. filterToolsByProfile
// ---------------------------------------------------------------------------

describe("filterToolsByProfile", () => {
  const allTools = [
    makeTool("mail_list"),
    makeTool("mail_read"),
    makeTool("mail_search"),
    makeTool("mail_send"),
    makeTool("mail_delete"),
    makeTool("mail_draft"),
    makeTool("mail_reply"),
    makeTool("mail_forward"),
    makeTool("mail_move"),
    makeTool("mail_flag"),
    makeTool("calendar_list"),
    makeTool("calendar_create"),
    makeTool("calendar_update"),
    makeTool("calendar_delete"),
    makeTool("calendar_accept"),
    makeTool("calendar_decline"),
    makeTool("calendar_freebusy"),
    makeTool("todo_tasks"),
    makeTool("todo_lists"),
    makeTool("todo_create"),
    makeTool("todo_complete"),
  ];

  describe("read-only profile", () => {
    it("allows read operations", () => {
      const filtered = filterToolsByProfile(allTools, "read-only");
      const names = filtered.map((t) => t.name);
      expect(names).toContain("mail_list");
      expect(names).toContain("mail_read");
      expect(names).toContain("mail_search");
      expect(names).toContain("calendar_list");
      expect(names).toContain("calendar_freebusy");
      expect(names).toContain("todo_tasks");
      expect(names).toContain("todo_lists");
    });

    it("blocks write operations", () => {
      const filtered = filterToolsByProfile(allTools, "read-only");
      const names = filtered.map((t) => t.name);
      expect(names).not.toContain("mail_send");
      expect(names).not.toContain("mail_delete");
      expect(names).not.toContain("mail_draft");
      expect(names).not.toContain("mail_reply");
      expect(names).not.toContain("mail_forward");
      expect(names).not.toContain("mail_move");
      expect(names).not.toContain("mail_flag");
      expect(names).not.toContain("calendar_create");
      expect(names).not.toContain("calendar_update");
      expect(names).not.toContain("calendar_delete");
      expect(names).not.toContain("calendar_accept");
      expect(names).not.toContain("calendar_decline");
      expect(names).not.toContain("todo_create");
      expect(names).not.toContain("todo_complete");
    });
  });

  describe("standard profile", () => {
    it("allows everything except delete", () => {
      const filtered = filterToolsByProfile(allTools, "standard");
      const names = filtered.map((t) => t.name);
      expect(names).toContain("mail_list");
      expect(names).toContain("mail_send");
      expect(names).toContain("mail_draft");
      expect(names).toContain("calendar_create");
      expect(names).toContain("todo_create");
    });

    it("blocks delete operations", () => {
      const filtered = filterToolsByProfile(allTools, "standard");
      const names = filtered.map((t) => t.name);
      expect(names).not.toContain("mail_delete");
      expect(names).not.toContain("calendar_delete");
    });
  });

  describe("full profile", () => {
    it("allows all tools including delete", () => {
      const filtered = filterToolsByProfile(allTools, "full");
      expect(filtered).toHaveLength(allTools.length);
    });
  });

  describe("admin profile", () => {
    it("allows all tools", () => {
      const filtered = filterToolsByProfile(allTools, "admin");
      expect(filtered).toHaveLength(allTools.length);
    });
  });

  it("returns empty array when no tools match", () => {
    const tools = [makeTool("mail_send")];
    const filtered = filterToolsByProfile(tools, "read-only");
    expect(filtered).toHaveLength(0);
  });

  it("handles empty tools array", () => {
    const filtered = filterToolsByProfile([], "standard");
    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. collectTools — integration with ServiceRegistry
// ---------------------------------------------------------------------------

describe("collectTools", () => {
  it("collects tools from enabled services and filters by profile", () => {
    // Build a mock registry with a Map-based approach matching the real class
    const mailModule = makeModule("mail", ["mail_list", "mail_read", "mail_send", "mail_delete"]);
    const calModule = makeModule("calendar", ["calendar_list", "calendar_create", "calendar_delete"]);
    const todoModule = makeModule("todo", ["todo_tasks", "todo_create"]);

    const modules = new Map<string, ServiceModule>();
    modules.set("mail", mailModule);
    modules.set("calendar", calModule);
    modules.set("todo", todoModule);

    const registry = {
      getEnabled(config: ServicesConfig): ServiceModule[] {
        const enabled: ServiceModule[] = [];
        for (const [id, mod] of modules) {
          const svc = config[id as keyof ServicesConfig];
          if (svc?.enabled) {
            enabled.push(mod);
          }
        }
        return enabled;
      },
      getAllTools(config: ServicesConfig): AgentTool[] {
        const tools: AgentTool[] = [];
        for (const mod of this.getEnabled(config)) {
          tools.push(...mod.tools());
        }
        return tools;
      },
    };

    const servicesConfig: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: false },
    };

    // Standard profile: everything except delete
    const tools = collectTools({
      registry: registry as any,
      servicesConfig,
      profile: "standard",
    });

    const names = tools.map((t) => t.name);
    expect(names).toContain("mail_list");
    expect(names).toContain("mail_read");
    expect(names).toContain("mail_send");
    expect(names).not.toContain("mail_delete");
    expect(names).toContain("calendar_list");
    expect(names).toContain("calendar_create");
    expect(names).not.toContain("calendar_delete");
    // todo is disabled
    expect(names).not.toContain("todo_tasks");
    expect(names).not.toContain("todo_create");
  });
});

// ---------------------------------------------------------------------------
// 4. buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("includes agent identity", () => {
    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "📎" },
      services: [],
    });
    expect(prompt).toContain("📎 Clippy");
    expect(prompt).toContain("AI assistant for Microsoft 365");
  });

  it("includes service descriptions", () => {
    const mailModule = makeModule("mail", [], {
      meta: {
        label: "Outlook Mail",
        description: "Read, send, and manage emails",
        requiredScopes: ["Mail.Read"],
      },
    });

    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "📎" },
      services: [mailModule],
    });
    expect(prompt).toContain("Outlook Mail");
    expect(prompt).toContain("Read, send, and manage emails");
  });

  it("includes user context", () => {
    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "📎" },
      services: [],
      userInfo: { displayName: "Bryan Rice", email: "bryan@example.com" },
      timezone: "America/New_York",
    });
    expect(prompt).toContain("Bryan Rice");
    expect(prompt).toContain("bryan@example.com");
    expect(prompt).toContain("America/New_York");
  });

  it("includes guidelines", () => {
    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "📎" },
      services: [],
    });
    expect(prompt).toContain("confirm with the user before sending");
    expect(prompt).toContain("confirm before deleting");
    expect(prompt).toContain("free/busy");
    expect(prompt).toContain("timezone");
  });

  it("includes prompt hints from services", () => {
    const module = makeModule("mail", [], {
      promptHints: () => ["User has VIP mail filtering enabled."],
    });

    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "📎" },
      services: [module],
    });
    expect(prompt).toContain("VIP mail filtering enabled");
  });

  it("includes explicit context hints", () => {
    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "📎" },
      services: [],
      contextHints: ["User prefers dark mode."],
    });
    expect(prompt).toContain("User prefers dark mode.");
  });

  it("uses defaults when identity fields are missing", () => {
    const prompt = buildSystemPrompt({
      identity: {},
      services: [],
    });
    expect(prompt).toContain("📎 Clippy");
  });
});

// ---------------------------------------------------------------------------
// 5. AgentSession
// ---------------------------------------------------------------------------

describe("AgentSession", () => {
  it("creates with a unique ID", () => {
    const s1 = new AgentSession();
    const s2 = new AgentSession();
    expect(s1.id).toBeTruthy();
    expect(s2.id).toBeTruthy();
    expect(s1.id).not.toBe(s2.id);
  });

  it("accepts a custom ID", () => {
    const session = new AgentSession("my-session");
    expect(session.id).toBe("my-session");
  });

  it("starts with empty messages", () => {
    const session = new AgentSession();
    expect(session.messages).toHaveLength(0);
    expect(session.getHistory()).toHaveLength(0);
  });

  it("adds user messages", () => {
    const session = new AgentSession();
    session.addUserMessage("Hello");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[0].content).toBe("Hello");
    expect(session.messages[0].timestamp).toBeGreaterThan(0);
  });

  it("adds assistant messages", () => {
    const session = new AgentSession();
    session.addAssistantMessage("Hi there!");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].role).toBe("assistant");
    expect(session.messages[0].content).toBe("Hi there!");
  });

  it("adds assistant messages with tool calls", () => {
    const session = new AgentSession();
    session.addAssistantMessage("Let me check...", [
      { id: "tc_1", name: "mail_list", input: { top: 5 } },
    ]);
    expect(session.messages[0].toolCalls).toHaveLength(1);
    expect(session.messages[0].toolCalls![0].name).toBe("mail_list");
  });

  it("returns a copy from getHistory", () => {
    const session = new AgentSession();
    session.addUserMessage("Hello");
    const history = session.getHistory();
    // Modifying the returned array should not affect internal state
    history.push({
      role: "user",
      content: "injected",
      timestamp: 0,
    });
    expect(session.messages).toHaveLength(1);
  });

  it("clears all messages", () => {
    const session = new AgentSession();
    session.addUserMessage("Hello");
    session.addAssistantMessage("Hi");
    expect(session.messages).toHaveLength(2);
    session.clear();
    expect(session.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. runAgent — Anthropic SDK integration
// ---------------------------------------------------------------------------

describe("runAgent", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const baseModelConfig = {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-5-20250514",
    apiKey: "sk-test",
    maxTokens: 4096,
  };

  const baseToolContext = {
    token: "graph-token",
    userId: "user-1",
  };

  it("returns text response for a simple message", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello! How can I help?" }],
      stop_reason: "end_turn",
    });

    const session = new AgentSession();
    const result = await runAgent({
      message: "Hello",
      session,
      modelConfig: baseModelConfig,
      tools: [],
      systemPrompt: "You are a helpful assistant.",
      toolContext: baseToolContext,
    });

    expect(result).toBe("Hello! How can I help?");
    expect(session.messages).toHaveLength(2); // user + assistant
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("assistant");
  });

  it("dispatches tool calls and returns final response", async () => {
    const mailListTool = makeTool("mail_list");

    // First API call: tool use
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Let me check your mail." },
        {
          type: "tool_use",
          id: "toolu_01",
          name: "mail_list",
          input: { top: 5 },
        },
      ],
      stop_reason: "tool_use",
    });

    // Second API call: final text response
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "You have 3 new emails." }],
      stop_reason: "end_turn",
    });

    const session = new AgentSession();
    const result = await runAgent({
      message: "Show my emails",
      session,
      modelConfig: baseModelConfig,
      tools: [mailListTool],
      systemPrompt: "You are a helpful assistant.",
      toolContext: baseToolContext,
    });

    expect(result).toBe("You have 3 new emails.");
    expect(mailListTool.execute).toHaveBeenCalledWith(
      { top: 5 },
      baseToolContext,
    );
  });

  it("calls onToolCall callback when tools are invoked", async () => {
    const onToolCall = vi.fn();
    const tool = makeTool("calendar_list");

    mockCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "toolu_02",
            name: "calendar_list",
            input: {},
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "No events today." }],
        stop_reason: "end_turn",
      });

    const session = new AgentSession();
    await runAgent({
      message: "What's on my calendar?",
      session,
      modelConfig: baseModelConfig,
      tools: [tool],
      systemPrompt: "You are a helper.",
      toolContext: baseToolContext,
      onToolCall,
    });

    expect(onToolCall).toHaveBeenCalledWith("calendar_list", {});
  });

  it("calls onResponse callback with final text", async () => {
    const onResponse = vi.fn();

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Done!" }],
      stop_reason: "end_turn",
    });

    const session = new AgentSession();
    await runAgent({
      message: "Thanks",
      session,
      modelConfig: baseModelConfig,
      tools: [],
      systemPrompt: "You are a helper.",
      toolContext: baseToolContext,
      onResponse,
    });

    expect(onResponse).toHaveBeenCalledWith("Done!");
  });

  it("handles tool execution errors gracefully", async () => {
    const failingTool = makeTool("mail_send", {
      execute: vi.fn().mockRejectedValue(new Error("Auth expired")),
    });

    mockCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "toolu_03",
            name: "mail_send",
            input: { to: "test@example.com" },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [
          {
            type: "text",
            text: "Sorry, I couldn't send the email due to an authentication error.",
          },
        ],
        stop_reason: "end_turn",
      });

    const session = new AgentSession();
    const result = await runAgent({
      message: "Send an email to test@example.com",
      session,
      modelConfig: baseModelConfig,
      tools: [failingTool],
      systemPrompt: "You are a helper.",
      toolContext: baseToolContext,
    });

    expect(result).toContain("authentication error");
  });

  it("handles unknown tool names gracefully", async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "toolu_04",
            name: "nonexistent_tool",
            input: {},
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "I couldn't find that tool." }],
        stop_reason: "end_turn",
      });

    const session = new AgentSession();
    const result = await runAgent({
      message: "Do something",
      session,
      modelConfig: baseModelConfig,
      tools: [makeTool("mail_list")],
      systemPrompt: "You are a helper.",
      toolContext: baseToolContext,
    });

    expect(result).toBe("I couldn't find that tool.");
  });

  it("respects maxTurns safety limit", async () => {
    // Always return tool_use to trigger the safety limit
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_loop",
          name: "mail_list",
          input: {},
        },
      ],
      stop_reason: "tool_use",
    });

    const session = new AgentSession();
    const result = await runAgent({
      message: "List emails forever",
      session,
      modelConfig: baseModelConfig,
      tools: [makeTool("mail_list")],
      systemPrompt: "You are a helper.",
      toolContext: baseToolContext,
      maxTurns: 3,
    });

    expect(result).toContain("maximum number of tool-calling turns");
    // Should have called the API exactly 3 times
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("handles multi-turn tool calls", async () => {
    const mailList = makeTool("mail_list");
    const mailRead = makeTool("mail_read");

    // Turn 1: list emails
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "Let me check." },
        {
          type: "tool_use",
          id: "toolu_05",
          name: "mail_list",
          input: { top: 3 },
        },
      ],
      stop_reason: "tool_use",
    });

    // Turn 2: read a specific email
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_06",
          name: "mail_read",
          input: { messageId: "msg-123" },
        },
      ],
      stop_reason: "tool_use",
    });

    // Turn 3: final response
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "Your latest email is from Alice about the project update.",
        },
      ],
      stop_reason: "end_turn",
    });

    const session = new AgentSession();
    const result = await runAgent({
      message: "Read my latest email",
      session,
      modelConfig: baseModelConfig,
      tools: [mailList, mailRead],
      systemPrompt: "You are a helper.",
      toolContext: baseToolContext,
    });

    expect(result).toContain("Alice");
    expect(mailList.execute).toHaveBeenCalled();
    expect(mailRead.execute).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("passes system prompt and tools to Anthropic API", async () => {
    const tool = makeTool("mail_list");

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
    });

    const session = new AgentSession();
    await runAgent({
      message: "Hi",
      session,
      modelConfig: baseModelConfig,
      tools: [tool],
      systemPrompt: "Custom system prompt.",
      toolContext: baseToolContext,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe("Custom system prompt.");
    expect(callArgs.model).toBe("claude-sonnet-4-5-20250514");
    expect(callArgs.max_tokens).toBe(4096);
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].name).toBe("mail_list");
    expect(callArgs.tools[0].input_schema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("sends no tools field when tools array is empty", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
    });

    const session = new AgentSession();
    await runAgent({
      message: "Hi",
      session,
      modelConfig: baseModelConfig,
      tools: [],
      systemPrompt: "System.",
      toolContext: baseToolContext,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
  });
});
