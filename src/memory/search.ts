import type { MemoryStore, SearchResult, SessionSummary } from "./store.js";

export type MemorySearchParams = {
  query: string;
  limit?: number;
};

export type MemoryContext = {
  recentSessions: SessionSummary[];
  relevantMessages: SearchResult[];
};

/**
 * Build context from memory for the agent's system prompt.
 * Returns recent sessions and any messages relevant to the current query.
 */
export function buildMemoryContext(
  store: MemoryStore,
  params: MemorySearchParams,
): MemoryContext {
  const recentSessions = store.listSessions({ limit: 5 });
  const relevantMessages = params.query
    ? store.searchMessages(params.query, { limit: params.limit ?? 10 })
    : [];

  return { recentSessions, relevantMessages };
}

/**
 * Format memory context as text for inclusion in agent prompts.
 */
export function formatMemoryContext(context: MemoryContext): string {
  const parts: string[] = [];

  if (context.recentSessions.length > 0) {
    parts.push("## Recent Conversations");
    for (const s of context.recentSessions) {
      const date = new Date(s.createdAt).toLocaleDateString();
      const preview = s.preview || "(no preview)";
      parts.push(`- ${date}: "${preview}" (${s.messageCount} messages)`);
    }
  }

  if (context.relevantMessages.length > 0) {
    parts.push("");
    parts.push("## Relevant Past Messages");
    for (const m of context.relevantMessages) {
      const date = new Date(m.timestamp).toLocaleDateString();
      const truncated =
        m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content;
      parts.push(`- [${m.role}, ${date}]: ${truncated}`);
    }
  }

  return parts.join("\n");
}
