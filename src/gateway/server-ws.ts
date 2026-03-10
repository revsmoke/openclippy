/**
 * WebSocket handler for the gateway.
 *
 * Manages client connections, session tracking, and message routing.
 * Uses the `ws` package. Handles upgrade on the /ws path only.
 */

import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import type {
  ClientMessage,
  ServerMessage,
  ClientSession,
} from "./types.js";

export type WsHandlerDeps = {
  /** Run the agent for a client ask message */
  runAsk: (message: string, profile?: string) => Promise<string>;
};

/**
 * Manages the WebSocket server and client sessions.
 */
export class WsHandler {
  private wss: WebSocketServer;
  private sessions = new Map<WebSocket, ClientSession>();
  private deps: WsHandlerDeps;

  constructor(httpServer: HttpServer, deps: WsHandlerDeps) {
    this.deps = deps;

    // Create a WS server with no automatic HTTP server — we handle upgrade ourselves
    this.wss = new WebSocketServer({ noServer: true });

    // Handle the upgrade event on the HTTP server
    httpServer.on("upgrade", (req: IncomingMessage, socket, head: Buffer) => {
      const pathname = (req.url ?? "/").split("?")[0];

      if (pathname === "/ws") {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req);
        });
      } else {
        // Reject upgrade for non-/ws paths
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
      }
    });

    this.wss.on("connection", (ws: WebSocket) => {
      this.handleConnection(ws);
    });
  }

  /** Number of active sessions */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Close all connections and the WS server */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all client connections
      for (const ws of this.sessions.keys()) {
        ws.close(1001, "Server shutting down");
      }
      this.sessions.clear();

      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ── Private ────────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    const session: ClientSession = {
      sessionId: randomUUID(),
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(ws, session);

    // Send the connected message
    this.send(ws, { type: "connected", sessionId: session.sessionId });

    ws.on("message", (raw: Buffer) => {
      session.lastActivity = Date.now();
      void this.handleMessage(ws, raw);
    });

    ws.on("close", () => {
      this.sessions.delete(ws);
    });

    ws.on("error", () => {
      this.sessions.delete(ws);
    });
  }

  private async handleMessage(ws: WebSocket, raw: Buffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      this.send(ws, {
        type: "error",
        id: "",
        error: "Invalid JSON message",
      });
      return;
    }

    if (msg.type === "ping") {
      this.send(ws, { type: "pong" });
      return;
    }

    if (msg.type === "ask") {
      try {
        const text = await this.deps.runAsk(msg.message, msg.profile);
        this.send(ws, { type: "response", id: msg.id, text });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.send(ws, { type: "error", id: msg.id, error });
      }
      return;
    }

    // Unknown message type
    this.send(ws, {
      type: "error",
      id: "",
      error: `Unknown message type: ${(msg as Record<string, unknown>).type}`,
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
