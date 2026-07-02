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
import { resolveModelConfig } from "../agents/model-config.js";
import { buildSystemPrompt } from "../agents/prompt-builder.js";
import { collectTools } from "../agents/tool-registry.js";
import { ServiceRegistry } from "../services/registry.js";
import { registerBuiltinModules } from "../services/builtin-modules.js";
import { ScopeManager } from "../auth/scope-manager.js";
import { MSALClient } from "../auth/msal-client.js";
import { resolveAzureCredentials } from "../auth/credentials.js";
import { loadConfig } from "../config/config.js";
import { getEnabledServiceIds, getToolProfile } from "../config/helpers.js";
import type { GatewayConfig } from "../config/types.gateway.js";

const TOKEN_RENEWAL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export class Gateway {
  private httpServer: http.Server | null = null;
  private wsHandler: WsHandler | null = null;
  private tokenRenewalTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private _port: number;
  private _host: string;
  private _isRunning = false;

  /** MSAL client + Graph scopes, built in start() from loaded config. Reused
   *  by both per-request token acquisition and the renewal loop. */
  private msalClient: MSALClient | null = null;
  private graphScopes: string[] = [];

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

    // Load the full config so the gateway agent honours the same settings as
    // the `ask`/`chat` commands (model, identity, enabled services, tool
    // profile, Azure app) instead of hardcoding them.
    const config = await loadConfig();

    // Azure app + MSAL client come from config (falls back to env/defaults).
    const creds = resolveAzureCredentials(config);
    this.msalClient = new MSALClient(creds);

    // Build the service registry and collect tools per the configured profile.
    const registry = new ServiceRegistry();
    registerBuiltinModules(registry);
    const servicesConfig = config.services ?? {};
    const profile = getToolProfile(config);
    const tools = collectTools({ registry, servicesConfig, profile });
    const enabledModules = registry.getEnabled(servicesConfig);
    const identity = config.agent?.identity ?? { name: "Clippy", emoji: "📎" };

    // Graph scopes needed by the enabled services — reused for renewal too.
    const scopeManager = new ScopeManager();
    this.graphScopes = scopeManager.computeRequiredScopes(getEnabledServiceIds(config));

    // Build the shared runAsk function used by both HTTP and WebSocket handlers.
    const runAsk = async (message: string, _profile?: string): Promise<string> => {
      // Create a transient session for each request.
      const session = new AgentSession();

      // Acquire a Graph token (silent when cached) so tools can call Graph.
      const tokenResult = await this.msalClient!.acquireToken(this.graphScopes);

      // Resolve model + API key from config (throws a clear error if missing).
      const modelConfig = resolveModelConfig(config.agent ?? {});

      // System prompt reflects the configured identity, enabled services, and user.
      const systemPrompt = buildSystemPrompt({
        identity,
        services: enabledModules,
        userInfo: {
          displayName: tokenResult.account?.name ?? undefined,
          email: tokenResult.account?.username ?? undefined,
        },
      });

      return runAgent({
        message,
        session,
        modelConfig,
        tools,
        systemPrompt,
        toolContext: {
          token: tokenResult.accessToken,
          userId: tokenResult.account?.localAccountId ?? undefined,
        },
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
      // Reuse the config-derived client + scopes built in start(), so renewal
      // targets the configured Azure app and the scopes the services need.
      if (!this.msalClient) return;
      await this.msalClient.acquireToken(this.graphScopes);
    } catch (err) {
      // Token renewal failure is non-fatal — log and continue
      console.warn("[Gateway] Token renewal failed:", err instanceof Error ? err.message : String(err));
    }
  }
}
