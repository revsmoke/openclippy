/**
 * HTTP request handler for the gateway.
 *
 * Routes:
 *   POST /webhooks/graph  — Graph change notifications
 *   POST /api/ask         — One-shot agent query
 *   GET  /health          — Health check
 *   *                     — 404
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getErrorMessage } from "../services/tool-utils.js";
import type {
  ErrorResponse,
  AskRequestBody,
  AskResponseBody,
  HealthResponse,
} from "./types.js";

export type HttpHandlerDeps = {
  /** Current uptime in seconds */
  getUptime: () => number;
  /** Number of active WebSocket sessions */
  getSessionCount: () => number;
  /** Run the agent for a one-shot query */
  runAsk: (message: string, profile?: string) => Promise<string>;
  /** Handle an incoming Graph change notification */
  onGraphNotification: (payload: unknown) => void;
};

/** Read the full request body as a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Send a JSON response. */
function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

/** Send a plain-text response. */
function sendText(
  res: ServerResponse,
  status: number,
  text: string,
): void {
  res.writeHead(status, {
    "Content-Type": "text/plain",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

// ── Route handlers ─────────────────────────────────────────

async function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  const body: HealthResponse = {
    status: "ok",
    uptime: deps.getUptime(),
    sessions: deps.getSessionCount(),
  };
  sendJson(res, 200, body);
}

async function handleAsk(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Failed to read request body", status: 400 } satisfies ErrorResponse);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON", status: 400 } satisfies ErrorResponse);
    return;
  }

  const body = parsed as Record<string, unknown>;
  if (!body.message || typeof body.message !== "string") {
    sendJson(res, 400, {
      error: "Missing required field: message (string)",
      status: 400,
    } satisfies ErrorResponse);
    return;
  }

  try {
    const askBody = body as unknown as AskRequestBody;
    const response = await deps.runAsk(askBody.message, askBody.profile);
    sendJson(res, 200, { response } satisfies AskResponseBody);
  } catch (err) {
    sendJson(res, 500, { error: getErrorMessage(err), status: 500 } satisfies ErrorResponse);
  }
}

async function handleGraphWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HttpHandlerDeps,
): Promise<void> {
  // Microsoft Graph sends a validationToken query param during subscription creation
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    sendText(res, 200, validationToken);
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Failed to read request body", status: 400 } satisfies ErrorResponse);
    return;
  }

  let payload: unknown;
  try {
    payload = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Invalid JSON", status: 400 } satisfies ErrorResponse);
    return;
  }

  // Fire-and-forget — acknowledge immediately
  deps.onGraphNotification(payload);
  res.writeHead(202);
  res.end();
}

// ── Main HTTP dispatch ──────────────────────────────────────

export function createHttpHandler(
  deps: HttpHandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method?.toUpperCase() ?? "GET";
    const pathname = (req.url ?? "/").split("?")[0];

    if (method === "GET" && pathname === "/health") {
      void handleHealth(req, res, deps);
      return;
    }

    if (method === "POST" && pathname === "/api/ask") {
      void handleAsk(req, res, deps);
      return;
    }

    if (method === "POST" && pathname === "/webhooks/graph") {
      void handleGraphWebhook(req, res, deps);
      return;
    }

    // 404 for everything else
    sendJson(res, 404, {
      error: "Not found",
      status: 404,
    } satisfies ErrorResponse);
  };
}
