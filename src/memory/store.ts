import Database from "better-sqlite3";
import type { AgentMessage } from "../agents/session.js";
import type { AgentSession } from "../agents/session.js";

export type SessionSummary = {
  id: string;
  createdAt: number;
  lastMessageAt: number;
  messageCount: number;
  /** First user message content, truncated to 100 chars */
  preview: string;
};

export type SearchResult = {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type SessionStats = {
  totalSessions: number;
  totalMessages: number;
  earliestSession: number | null;
  latestSession: number | null;
};

/**
 * Persistent memory store backed by SQLite (better-sqlite3).
 *
 * Stores agent sessions and their messages so the agent can recall
 * prior conversations and search across its history.
 */
export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS sessions (",
        "  id TEXT PRIMARY KEY,",
        "  created_at INTEGER NOT NULL,",
        "  updated_at INTEGER NOT NULL",
        ");",
        "",
        "CREATE TABLE IF NOT EXISTS messages (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,",
        "  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),",
        "  content TEXT NOT NULL DEFAULT '',",
        "  tool_calls TEXT,",
        "  tool_results TEXT,",
        "  timestamp INTEGER NOT NULL",
        ");",
        "",
        "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);",
        "CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);",
      ].join("\n"),
    );
  }

  /** Save a session and all its messages (upsert). */
  saveSession(session: AgentSession): void {
    const now = Date.now();

    const upsertSession = this.db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET updated_at = ?",
    );

    const deleteMessages = this.db.prepare(
      "DELETE FROM messages WHERE session_id = ?",
    );

    const insertMessage = this.db.prepare(
      "INSERT INTO messages (session_id, role, content, tool_calls, tool_results, timestamp) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );

    const transaction = this.db.transaction(() => {
      upsertSession.run(session.id, now, now, now);
      deleteMessages.run(session.id);

      for (const msg of session.messages) {
        insertMessage.run(
          session.id,
          msg.role,
          msg.content,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.toolResults ? JSON.stringify(msg.toolResults) : null,
          msg.timestamp,
        );
      }
    });

    transaction();
  }

  /** Load a session by ID. Returns null if not found. */
  loadSession(
    sessionId: string,
  ): { id: string; messages: AgentMessage[] } | null {
    const session = this.db
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .get(sessionId) as { id: string } | undefined;

    if (!session) return null;

    const rows = this.db
      .prepare(
        "SELECT role, content, tool_calls, tool_results, timestamp " +
          "FROM messages WHERE session_id = ? " +
          "ORDER BY timestamp ASC, id ASC",
      )
      .all(sessionId) as Array<{
      role: string;
      content: string;
      tool_calls: string | null;
      tool_results: string | null;
      timestamp: number;
    }>;

    const messages: AgentMessage[] = rows.map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
      toolCalls: row.tool_calls
        ? (JSON.parse(row.tool_calls) as AgentMessage["toolCalls"])
        : undefined,
      toolResults: row.tool_results
        ? (JSON.parse(row.tool_results) as AgentMessage["toolResults"])
        : undefined,
      timestamp: row.timestamp,
    }));

    return { id: session.id, messages };
  }

  /** List sessions ordered by most recently updated first. */
  listSessions(params?: { limit?: number; offset?: number }): SessionSummary[] {
    const limit = params?.limit ?? 20;
    const offset = params?.offset ?? 0;

    const rows = this.db
      .prepare(
        "SELECT s.id, s.created_at AS createdAt, " +
          "MAX(m.timestamp) AS lastMessageAt, " +
          "COUNT(m.id) AS messageCount, " +
          "(SELECT content FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp ASC LIMIT 1) AS preview " +
          "FROM sessions s LEFT JOIN messages m ON m.session_id = s.id " +
          "GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ? OFFSET ?",
      )
      .all(limit, offset) as Array<{
      id: string;
      createdAt: number;
      lastMessageAt: number | null;
      messageCount: number;
      preview: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt ?? row.createdAt,
      messageCount: row.messageCount,
      preview: (row.preview ?? "").slice(0, 100),
    }));
  }

  /** Delete a session and all its messages (cascades via FK). */
  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  /** Search message content across all sessions (case-insensitive LIKE). */
  searchMessages(
    query: string,
    params?: { limit?: number },
  ): SearchResult[] {
    const limit = params?.limit ?? 20;

    const rows = this.db
      .prepare(
        "SELECT session_id, role, content, timestamp FROM messages " +
          "WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?",
      )
      .all(`%${query}%`, limit) as Array<{
      session_id: string;
      role: string;
      content: string;
      timestamp: number;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      role: row.role as "user" | "assistant",
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  /** Get aggregate stats about stored sessions. */
  getSessionStats(): SessionStats {
    const row = this.db
      .prepare(
        "SELECT COUNT(DISTINCT s.id) AS totalSessions, " +
          "COUNT(m.id) AS totalMessages, " +
          "MIN(s.created_at) AS earliestSession, " +
          "MAX(s.updated_at) AS latestSession " +
          "FROM sessions s LEFT JOIN messages m ON m.session_id = s.id",
      )
      .get() as {
      totalSessions: number;
      totalMessages: number;
      earliestSession: number | null;
      latestSession: number | null;
    };

    return row;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
