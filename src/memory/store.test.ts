import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentSession } from "../agents/session.js";
import { MemoryStore } from "./store.js";

describe("MemoryStore", () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "openclippy-test-"));
    store = new MemoryStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  it("creates tables on initialization", () => {
    // If we can save and load without error, tables were created
    const session = new AgentSession("init-test");
    session.addUserMessage("hello");
    store.saveSession(session);

    const loaded = store.loadSession("init-test");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("init-test");
  });

  // -----------------------------------------------------------------------
  // saveSession / loadSession
  // -----------------------------------------------------------------------

  it("saveSession persists a new session with messages", () => {
    const session = new AgentSession("save-test");
    session.addUserMessage("What is the weather?");
    session.addAssistantMessage("It's sunny today.");

    store.saveSession(session);

    const loaded = store.loadSession("save-test");
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(2);
  });

  it("loadSession returns session with all messages in order", () => {
    const session = new AgentSession("order-test");
    session.addUserMessage("first");
    session.addAssistantMessage("second");
    session.addUserMessage("third");

    store.saveSession(session);

    const loaded = store.loadSession("order-test");
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[0].role).toBe("user");
    expect(loaded!.messages[0].content).toBe("first");
    expect(loaded!.messages[1].role).toBe("assistant");
    expect(loaded!.messages[1].content).toBe("second");
    expect(loaded!.messages[2].role).toBe("user");
    expect(loaded!.messages[2].content).toBe("third");
  });

  it("loadSession returns null for non-existent session", () => {
    const loaded = store.loadSession("does-not-exist");
    expect(loaded).toBeNull();
  });

  it("saveSession updates an existing session (adds new messages)", () => {
    const session = new AgentSession("update-test");
    session.addUserMessage("initial message");
    store.saveSession(session);

    // Add more messages and save again
    session.addAssistantMessage("response");
    session.addUserMessage("follow-up");
    store.saveSession(session);

    const loaded = store.loadSession("update-test");
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.messages[2].content).toBe("follow-up");
  });

  // -----------------------------------------------------------------------
  // listSessions
  // -----------------------------------------------------------------------

  it("listSessions returns recent sessions with metadata", () => {
    const s1 = new AgentSession("list-1");
    s1.addUserMessage("Hello from session one");
    s1.addAssistantMessage("Hi there");
    store.saveSession(s1);

    const s2 = new AgentSession("list-2");
    s2.addUserMessage("Hello from session two");
    store.saveSession(s2);

    const list = store.listSessions();
    expect(list.length).toBe(2);

    // Each entry should have the expected shape
    for (const entry of list) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("createdAt");
      expect(entry).toHaveProperty("lastMessageAt");
      expect(entry).toHaveProperty("messageCount");
      expect(entry).toHaveProperty("preview");
      expect(typeof entry.createdAt).toBe("number");
      expect(typeof entry.messageCount).toBe("number");
    }
  });

  it("listSessions respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      const s = new AgentSession(`limit-${i}`);
      s.addUserMessage(`Message ${i}`);
      store.saveSession(s);
    }

    const list = store.listSessions({ limit: 3 });
    expect(list).toHaveLength(3);
  });

  it("listSessions respects offset parameter", () => {
    for (let i = 0; i < 5; i++) {
      const s = new AgentSession(`offset-${i}`);
      s.addUserMessage(`Message ${i}`);
      store.saveSession(s);
    }

    const allSessions = store.listSessions({ limit: 100 });
    const offsetSessions = store.listSessions({ limit: 100, offset: 2 });
    expect(offsetSessions).toHaveLength(allSessions.length - 2);
  });

  it("listSessions preview is truncated to 100 chars", () => {
    const session = new AgentSession("preview-test");
    const longMessage = "A".repeat(200);
    session.addUserMessage(longMessage);
    store.saveSession(session);

    const list = store.listSessions();
    const entry = list.find((s) => s.id === "preview-test");
    expect(entry).toBeDefined();
    expect(entry!.preview.length).toBeLessThanOrEqual(100);
  });

  // -----------------------------------------------------------------------
  // deleteSession
  // -----------------------------------------------------------------------

  it("deleteSession removes session and all its messages", () => {
    const session = new AgentSession("delete-test");
    session.addUserMessage("to be deleted");
    session.addAssistantMessage("also deleted");
    store.saveSession(session);

    // Verify it exists
    expect(store.loadSession("delete-test")).not.toBeNull();

    store.deleteSession("delete-test");

    expect(store.loadSession("delete-test")).toBeNull();

    // Also verify it's gone from listSessions
    const list = store.listSessions();
    expect(list.find((s) => s.id === "delete-test")).toBeUndefined();
  });

  it("deleteSession for non-existent session doesn't throw", () => {
    expect(() => store.deleteSession("nonexistent")).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // searchMessages
  // -----------------------------------------------------------------------

  it("searchMessages finds messages by keyword across sessions", () => {
    const s1 = new AgentSession("search-1");
    s1.addUserMessage("Tell me about the weather forecast");
    s1.addAssistantMessage("It will be sunny tomorrow");
    store.saveSession(s1);

    const s2 = new AgentSession("search-2");
    s2.addUserMessage("What about the traffic?");
    s2.addAssistantMessage("The weather is affecting traffic");
    store.saveSession(s2);

    const results = store.searchMessages("weather");
    expect(results.length).toBeGreaterThanOrEqual(2);

    for (const result of results) {
      expect(result.content.toLowerCase()).toContain("weather");
      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("role");
      expect(result).toHaveProperty("timestamp");
    }
  });

  it("searchMessages returns empty array when no matches", () => {
    const session = new AgentSession("no-match");
    session.addUserMessage("hello world");
    store.saveSession(session);

    const results = store.searchMessages("xylophone");
    expect(results).toEqual([]);
  });

  it("searchMessages respects limit parameter", () => {
    const session = new AgentSession("limit-search");
    for (let i = 0; i < 10; i++) {
      session.addUserMessage(`Message about cats number ${i}`);
    }
    store.saveSession(session);

    const results = store.searchMessages("cats", { limit: 3 });
    expect(results).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // getSessionStats
  // -----------------------------------------------------------------------

  it("getSessionStats returns count and date range", () => {
    const s1 = new AgentSession("stats-1");
    s1.addUserMessage("hello");
    store.saveSession(s1);

    const s2 = new AgentSession("stats-2");
    s2.addUserMessage("world");
    s2.addAssistantMessage("!");
    store.saveSession(s2);

    const stats = store.getSessionStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalMessages).toBe(3);
    expect(stats.earliestSession).not.toBeNull();
    expect(stats.latestSession).not.toBeNull();
    expect(typeof stats.earliestSession).toBe("number");
    expect(typeof stats.latestSession).toBe("number");
  });

  it("getSessionStats returns nulls for empty database", () => {
    const stats = store.getSessionStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.earliestSession).toBeNull();
    expect(stats.latestSession).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Tool calls / tool results serialization
  // -----------------------------------------------------------------------

  it("handles messages with tool calls and tool results (JSON serialization)", () => {
    const session = new AgentSession("tools-test");
    session.addUserMessage("What's on my calendar?");
    session.addAssistantMessage(
      "Let me check your calendar.",
      [
        {
          id: "call_001",
          name: "get_calendar_events",
          input: { startDate: "2026-03-10", endDate: "2026-03-11" },
        },
      ],
      [
        {
          id: "call_001",
          content: JSON.stringify([
            { subject: "Team standup", start: "9:00 AM" },
          ]),
          isError: false,
        },
      ],
    );

    store.saveSession(session);

    const loaded = store.loadSession("tools-test");
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(2);

    const assistantMsg = loaded!.messages[1];
    expect(assistantMsg.toolCalls).toBeDefined();
    expect(assistantMsg.toolCalls).toHaveLength(1);
    expect(assistantMsg.toolCalls![0].name).toBe("get_calendar_events");
    expect(assistantMsg.toolCalls![0].input).toEqual({
      startDate: "2026-03-10",
      endDate: "2026-03-11",
    });

    expect(assistantMsg.toolResults).toBeDefined();
    expect(assistantMsg.toolResults).toHaveLength(1);
    expect(assistantMsg.toolResults![0].id).toBe("call_001");
    expect(assistantMsg.toolResults![0].isError).toBe(false);
  });

  it("handles messages with no tool calls/results (null handling)", () => {
    const session = new AgentSession("no-tools-test");
    session.addUserMessage("Just a plain question");
    session.addAssistantMessage("Just a plain answer");

    store.saveSession(session);

    const loaded = store.loadSession("no-tools-test");
    expect(loaded).not.toBeNull();

    const userMsg = loaded!.messages[0];
    expect(userMsg.toolCalls).toBeUndefined();
    expect(userMsg.toolResults).toBeUndefined();

    const assistantMsg = loaded!.messages[1];
    expect(assistantMsg.toolCalls).toBeUndefined();
    expect(assistantMsg.toolResults).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("handles saving an empty session (no messages)", () => {
    const session = new AgentSession("empty-session");
    store.saveSession(session);

    const loaded = store.loadSession("empty-session");
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(0);

    const list = store.listSessions();
    const entry = list.find((s) => s.id === "empty-session");
    expect(entry).toBeDefined();
    expect(entry!.messageCount).toBe(0);
    expect(entry!.preview).toBe("");
  });
});
