import { describe, it, expect, beforeEach } from "vitest";
import { buildMemoryContext, formatMemoryContext } from "./search.js";
import type { MemoryStore, SessionSummary, SearchResult } from "./store.js";

// ---------------------------------------------------------------------------
// Mock MemoryStore — just an object satisfying the methods we call
// ---------------------------------------------------------------------------

function makeMockStore(overrides?: {
  listSessions?: (params?: { limit?: number; offset?: number }) => SessionSummary[];
  searchMessages?: (query: string, params?: { limit?: number }) => SearchResult[];
}): MemoryStore {
  return {
    listSessions: overrides?.listSessions ?? (() => []),
    searchMessages: overrides?.searchMessages ?? (() => []),
  } as unknown as MemoryStore;
}

const sampleSessions: SessionSummary[] = [
  {
    id: "sess-1",
    createdAt: 1710000000000,
    lastMessageAt: 1710000060000,
    messageCount: 5,
    preview: "What meetings do I have today?",
  },
  {
    id: "sess-2",
    createdAt: 1709900000000,
    lastMessageAt: 1709900030000,
    messageCount: 3,
    preview: "Draft an email to the team",
  },
];

const sampleSearchResults: SearchResult[] = [
  {
    sessionId: "sess-1",
    role: "user",
    content: "What meetings do I have today?",
    timestamp: 1710000000000,
  },
  {
    sessionId: "sess-1",
    role: "assistant",
    content: "You have 3 meetings scheduled for today.",
    timestamp: 1710000001000,
  },
];

describe("buildMemoryContext", () => {
  it("builds context with recent sessions and relevant messages", () => {
    const store = makeMockStore({
      listSessions: () => sampleSessions,
      searchMessages: () => sampleSearchResults,
    });

    const ctx = buildMemoryContext(store, { query: "meetings" });

    expect(ctx.recentSessions).toEqual(sampleSessions);
    expect(ctx.relevantMessages).toEqual(sampleSearchResults);
  });

  it("handles empty query (no search performed)", () => {
    const searchFn = (_q: string, _p?: { limit?: number }) => {
      throw new Error("should not be called");
    };

    const store = makeMockStore({
      listSessions: () => sampleSessions,
      searchMessages: searchFn,
    });

    const ctx = buildMemoryContext(store, { query: "" });

    expect(ctx.recentSessions).toEqual(sampleSessions);
    expect(ctx.relevantMessages).toEqual([]);
  });

  it("respects limit parameter for search results", () => {
    let capturedLimit: number | undefined;

    const store = makeMockStore({
      listSessions: () => [],
      searchMessages: (_q: string, params?: { limit?: number }) => {
        capturedLimit = params?.limit;
        return [];
      },
    });

    buildMemoryContext(store, { query: "test", limit: 5 });
    expect(capturedLimit).toBe(5);
  });

  it("defaults limit to 10 when not specified", () => {
    let capturedLimit: number | undefined;

    const store = makeMockStore({
      listSessions: () => [],
      searchMessages: (_q: string, params?: { limit?: number }) => {
        capturedLimit = params?.limit;
        return [];
      },
    });

    buildMemoryContext(store, { query: "test" });
    expect(capturedLimit).toBe(10);
  });
});

describe("formatMemoryContext", () => {
  it("produces readable text with sessions and messages", () => {
    const text = formatMemoryContext({
      recentSessions: sampleSessions,
      relevantMessages: sampleSearchResults,
    });

    expect(text).toContain("## Recent Conversations");
    expect(text).toContain("What meetings do I have today?");
    expect(text).toContain("Draft an email to the team");
    expect(text).toContain("5 messages");
    expect(text).toContain("3 messages");

    expect(text).toContain("## Relevant Past Messages");
    expect(text).toContain("[user,");
    expect(text).toContain("[assistant,");
    expect(text).toContain("You have 3 meetings scheduled for today.");
  });

  it("handles empty context (no sessions, no messages)", () => {
    const text = formatMemoryContext({
      recentSessions: [],
      relevantMessages: [],
    });

    expect(text).toBe("");
  });

  it("handles context with sessions but no relevant messages", () => {
    const text = formatMemoryContext({
      recentSessions: sampleSessions,
      relevantMessages: [],
    });

    expect(text).toContain("## Recent Conversations");
    expect(text).not.toContain("## Relevant Past Messages");
  });

  it("truncates long message content in relevant messages", () => {
    const longContent = "A".repeat(300);
    const text = formatMemoryContext({
      recentSessions: [],
      relevantMessages: [
        {
          sessionId: "s-1",
          role: "user",
          content: longContent,
          timestamp: 1710000000000,
        },
      ],
    });

    // Should contain the truncated version (200 chars + "...")
    expect(text).toContain("...");
    // Should NOT contain the full 300-char string
    expect(text).not.toContain(longContent);
  });

  it("handles session with empty preview", () => {
    const text = formatMemoryContext({
      recentSessions: [
        {
          id: "empty-preview",
          createdAt: 1710000000000,
          lastMessageAt: 1710000000000,
          messageCount: 0,
          preview: "",
        },
      ],
      relevantMessages: [],
    });

    expect(text).toContain("(no preview)");
  });
});
