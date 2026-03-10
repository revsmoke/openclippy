/**
 * Gateway types — WebSocket message protocol, client sessions, and server state.
 */

/** Client-to-server messages */
export type ClientMessage =
  | { type: "ask"; id: string; message: string; profile?: string }
  | { type: "ping" };

/** Server-to-client messages */
export type ServerMessage =
  | { type: "response"; id: string; text: string }
  | { type: "tool_call"; id: string; tool: string; input: unknown }
  | { type: "error"; id: string; error: string }
  | { type: "pong" }
  | { type: "connected"; sessionId: string };

/** Tracks a connected WebSocket client */
export type ClientSession = {
  sessionId: string;
  connectedAt: number;
  lastActivity: number;
};

/** HTTP JSON error response body */
export type ErrorResponse = {
  error: string;
  status: number;
};

/** POST /api/ask request body */
export type AskRequestBody = {
  message: string;
  profile?: string;
};

/** POST /api/ask response body */
export type AskResponseBody = {
  response: string;
};

/** Health check response */
export type HealthResponse = {
  status: "ok";
  uptime: number;
  sessions: number;
};
