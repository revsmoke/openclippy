/**
 * Gateway — Main orchestrator for the OpenClippy daemon.
 *
 * Manages:
 *   - HTTP server (health, webhooks, REST /api/ask)
 *   - WebSocket server (interactive client sessions)
 *   - Token renewal loop (MSAL silent refresh)
 */

import http from "node:http";
import { createHttpHandler, type HttpHandlerDeps } from "./server-http.js";
import { WsHandler } from "./server-ws.js";
import { runAgent } from "../agents/runtime.js";
import { AgentSession } from "../agents/session.js";
import type { GatewayConfig } from "../config/types.gateway.js";
import { resolveAzureCredentials } from "../auth/credentials.js";

const TOKEN_RENEWAL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export class Gateway {
  private httpServer: http.Server | null = null;
  private wsHandler: WsHandler | null = null;
  private tokenRenewalTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private _port: number;
  private _host: string;
  private _isRunning = false;

  constructor(config?: GatewayConfig) {
    this._port = config?.port ?? 4100;
    this._host = config?.host ?? "localhost";
  }

  /** The actual port the server is listening on (useful when port=0). */
  get port(): number {
    if (this.httpServer) {
      const addr = this.httpServer.address();
      if (addr && typeof addr === "object") {
        return addr.port;
      }
    }
    return this._port;
  }

  /** Whether the gateway is currently running. */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Number of active WebSocket client sessions. */
  get sessionCount(): number {
    return this.wsHandler?.sessionCount ?? 0;
  }

  /** Start the gateway (HTTP + WS servers, token renewal). */
  async start(): Promise<void> {
    if (this._isRunning) return;

    this.startedAt = Date.now();

    // Build the shared runAsk function
    const runAsk = async (message: string, _profile?: string): Promise<string> => {
      // Create a transient session for each request
      const session = new AgentSession();
      return runAgent({
        message,
        session,
        modelConfig: {
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250514",
          apiKey: process.env.ANTHROPIC_API_KEY ?? "",
          maxTokens: 4096,
        },
        tools: [],
        systemPrompt: "You are Clippy, an AI assistant for Microsoft 365.",
        toolContext: { token: "" },
      });
    };

    // HTTP handler dependencies
    const httpDeps: HttpHandlerDeps = {
      getUptime: () => Math.floor((Date.now() - this.startedAt) / 1000),
      getSessionCount: () => this.sessionCount,
      runAsk,
      onGraphNotification: (_payload: unknown) => {
        // TODO: Route to service module subscription handlers
      },
    };

    // Create HTTP server
    const handler = createHttpHandler(httpDeps);
    this.httpServer = http.createServer(handler);

    // Attach WebSocket handler (handles upgrade events on /ws)
    this.wsHandler = new WsHandler(this.httpServer, { runAsk });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on("error", reject);
      this.httpServer!.listen(this._port, this._host, () => resolve());
    });

    // Start token renewal loop
    this.tokenRenewalTimer = setInterval(() => {
      void this.renewToken();
    }, TOKEN_RENEWAL_INTERVAL_MS);

    this._isRunning = true;
  }

  /** Gracefully stop the gateway. */
  async stop(): Promise<void> {
    if (!this._isRunning) return;

    // Stop token renewal
    if (this.tokenRenewalTimer) {
      clearInterval(this.tokenRenewalTimer);
      this.tokenRenewalTimer = null;
    }

    // Close WebSocket connections
    if (this.wsHandler) {
      await this.wsHandler.close();
      this.wsHandler = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    this._isRunning = false;
  }

  /** Silently refresh the MSAL token. Errors are logged, not thrown. */
  private async renewToken(): Promise<void> {
    try {
      // Dynamic import to avoid hard dependency when mocking
      const { MSALClient } = await import("../auth/msal-client.js");
      const creds = resolveAzureCredentials();
      const client = new MSALClient(creds);
      await client.acquireToken(["https://graph.microsoft.com/.default"]);
    } catch (err) {
      // Token renewal failure is non-fatal — log and continue
      console.warn("[Gateway] Token renewal failed:", err instanceof Error ? err.message : String(err));
    }
  }
}
