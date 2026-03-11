import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import { Gateway } from "./server.js";
import type {
  ServerMessage,
  ClientMessage,
  HealthResponse,
  ErrorResponse,
  AskResponseBody,
} from "./types.js";

// ── Mocks ──────────────────────────────────────────────────

vi.mock("../agents/runtime.js", () => ({
  runAgent: vi.fn(async () => "mock agent response"),
}));

vi.mock("../auth/msal-client.js", () => ({
  MSALClient: vi.fn().mockImplementation(() => ({
    acquireToken: vi.fn(async () => ({
      accessToken: "mock-token",
      account: { homeAccountId: "test" },
    })),
    isAuthenticated: vi.fn(async () => true),
    getAccount: vi.fn(async () => ({ homeAccountId: "test" })),
  })),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(async () => ({
    azure: { clientId: "test-client", tenantId: "test-tenant" },
    services: { mail: { enabled: true } },
    agent: { model: "claude-sonnet-4-5-20250514", toolProfile: "standard" },
    tools: { profile: "standard", allow: [], deny: [] },
    gateway: { port: 0, host: "127.0.0.1" },
  })),
}));

vi.mock("../services/registry.js", () => ({
  ServiceRegistry: vi.fn().mockImplementation(() => ({
    getAllTools: vi.fn(() => []),
    getEnabled: vi.fn(() => []),
    register: vi.fn(),
    listRegistered: vi.fn(() => []),
  })),
}));

// ── Helpers ─────────────────────────────────────────────────

const TEST_HOST = "127.0.0.1";

function httpRequest(
  method: string,
  path: string,
  port: number,
  body?: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: TEST_HOST,
        port,
        path,
        method,
        headers: body
          ? { "Content-Type": "application/json" }
          : undefined,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function connectWs(port: number, timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${TEST_HOST}:${port}/ws`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`connectWs timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.once("message", (raw: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as ServerMessage);
    });
  });
}

/** Wait for a WebSocket close event. */
function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error(`waitForClose timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Connect to the gateway WS and consume the initial "connected" message.
 *
 * IMPORTANT: The message listener is registered BEFORE the connection opens
 * to avoid a race condition where the server's "connected" message arrives
 * before waitForMessage registers its listener.
 */
async function connectAndInit(port: number): Promise<{ ws: WebSocket; sessionId: string }> {
  const ws = new WebSocket(`ws://${TEST_HOST}:${port}/ws`);

  // Register message listener immediately, BEFORE the connection opens,
  // so we never miss the server's "connected" message.
  const msgPromise = waitForMessage(ws);

  // Wait for the connection to open
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("connectAndInit: connection timed out after 5000ms"));
    }, 5000);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const msg = await msgPromise;
  if (msg.type !== "connected") throw new Error(`Expected connected, got ${msg.type}`);
  return { ws, sessionId: msg.sessionId };
}

// ── HTTP Tests (single shared gateway for all HTTP tests) ───

describe("Gateway HTTP", () => {
  let gateway: Gateway;

  beforeAll(async () => {
    gateway = new Gateway({ port: 0, host: TEST_HOST });
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const { status, data } = await httpRequest("GET", "/health", gateway.port);
      expect(status).toBe(200);
      const body = JSON.parse(data) as HealthResponse;
      expect(body.status).toBe("ok");
      expect(typeof body.uptime).toBe("number");
      expect(typeof body.sessions).toBe("number");
    });
  });

  describe("POST /api/ask", () => {
    it("returns agent response for valid request", async () => {
      const { status, data } = await httpRequest(
        "POST",
        "/api/ask",
        gateway.port,
        JSON.stringify({ message: "hello" }),
      );
      expect(status).toBe(200);
      const body = JSON.parse(data) as AskResponseBody;
      expect(body.response).toBe("mock agent response");
    });

    it("returns 400 for missing message field", async () => {
      const { status, data } = await httpRequest(
        "POST",
        "/api/ask",
        gateway.port,
        JSON.stringify({}),
      );
      expect(status).toBe(400);
      const body = JSON.parse(data) as ErrorResponse;
      expect(body.error).toMatch(/message/i);
    });

    it("returns 400 for invalid JSON", async () => {
      const { status, data } = await httpRequest(
        "POST",
        "/api/ask",
        gateway.port,
        "not json",
      );
      expect(status).toBe(400);
      const body = JSON.parse(data) as ErrorResponse;
      expect(body.error).toBeDefined();
    });
  });

  describe("POST /webhooks/graph", () => {
    it("returns 200 with validationToken when provided", async () => {
      const { status, data } = await httpRequest(
        "POST",
        "/webhooks/graph?validationToken=abc123",
        gateway.port,
      );
      expect(status).toBe(200);
      expect(data).toBe("abc123");
    });

    it("returns 202 for notification payload", async () => {
      const { status } = await httpRequest(
        "POST",
        "/webhooks/graph",
        gateway.port,
        JSON.stringify({ value: [{ resource: "/me/messages" }] }),
      );
      expect(status).toBe(202);
    });
  });

  describe("404 for unknown routes", () => {
    it("returns 404 for GET /nonexistent", async () => {
      const { status, data } = await httpRequest("GET", "/nonexistent", gateway.port);
      expect(status).toBe(404);
      const body = JSON.parse(data) as ErrorResponse;
      expect(body.error).toMatch(/not found/i);
    });
  });
});

// ── WebSocket Tests (each test owns its gateway) ────────────

describe("Gateway WebSocket", () => {
  it("sends connected message with sessionId on connect", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const { ws, sessionId } = await connectAndInit(gw.port);
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
      ws.close();
    } finally {
      await gw.stop();
    }
  });

  it("responds with pong to ping", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const { ws } = await connectAndInit(gw.port);

      const pingMsg: ClientMessage = { type: "ping" };
      ws.send(JSON.stringify(pingMsg));

      const msg = await waitForMessage(ws);
      expect(msg.type).toBe("pong");
      ws.close();
    } finally {
      await gw.stop();
    }
  });

  it("responds to ask with agent response", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const { ws } = await connectAndInit(gw.port);

      const askMsg: ClientMessage = {
        type: "ask",
        id: "req-1",
        message: "hello agent",
      };
      ws.send(JSON.stringify(askMsg));

      const msg = await waitForMessage(ws);
      expect(msg.type).toBe("response");
      if (msg.type === "response") {
        expect(msg.id).toBe("req-1");
        expect(msg.text).toBe("mock agent response");
      }
      ws.close();
    } finally {
      await gw.stop();
    }
  });

  it("returns error for invalid JSON", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const { ws } = await connectAndInit(gw.port);

      ws.send("not valid json");

      const msg = await waitForMessage(ws);
      expect(msg.type).toBe("error");
      if (msg.type === "error") {
        expect(msg.error).toMatch(/invalid/i);
      }
      ws.close();
    } finally {
      await gw.stop();
    }
  });

  it("returns error for unknown message type", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const { ws } = await connectAndInit(gw.port);

      ws.send(JSON.stringify({ type: "unknown_msg" }));

      const msg = await waitForMessage(ws);
      expect(msg.type).toBe("error");
      ws.close();
    } finally {
      await gw.stop();
    }
  });

  it("tracks session count", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const { ws: ws1 } = await connectAndInit(gw.port);
      expect(gw.sessionCount).toBe(1);

      const { ws: ws2 } = await connectAndInit(gw.port);
      expect(gw.sessionCount).toBe(2);

      const ws1Closed = waitForClose(ws1);
      ws1.close();
      await ws1Closed;
      // Small delay for server-side close handler to fire
      await new Promise((r) => setTimeout(r, 50));
      expect(gw.sessionCount).toBe(1);

      const ws2Closed = waitForClose(ws2);
      ws2.close();
      await ws2Closed;
      await new Promise((r) => setTimeout(r, 50));
      expect(gw.sessionCount).toBe(0);
    } finally {
      await gw.stop();
    }
  });

  it("rejects WebSocket upgrade on non-/ws path", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();
    try {
      const ws = new WebSocket(`ws://${TEST_HOST}:${gw.port}/other`);
      const closed = new Promise<number>((resolve) => {
        ws.on("close", (code: number) => resolve(code));
        ws.on("error", () => resolve(-1));
      });
      const code = await closed;
      // Connection should fail
      expect(code).not.toBe(1000);
    } finally {
      await gw.stop();
    }
  });
});

// ── Graceful shutdown ──────────────────────────────────────

describe("Gateway graceful shutdown", () => {
  it("closes server and all client connections on stop()", async () => {
    const gw = new Gateway({ port: 0, host: TEST_HOST });
    await gw.start();

    const { ws } = await connectAndInit(gw.port);

    const closedPromise = waitForClose(ws);

    await gw.stop();
    await closedPromise;

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});

// ── Token renewal ──────────────────────────────────────────

describe("Gateway token renewal", () => {
  it("runs token renewal loop without crashing", async () => {
    vi.useFakeTimers();
    const gw = new Gateway({ port: 0, host: "127.0.0.1" });
    await gw.start();

    // Advance time by 31 minutes (token renewal runs every 30 min)
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    // Gateway should still be running
    expect(gw.isRunning).toBe(true);

    await gw.stop();
    vi.useRealTimers();
  });

  it("does not contain hardcoded Azure credentials in source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(import.meta.dirname, "server.ts"),
      "utf-8",
    );
    expect(source).not.toContain("bfe7dd6e-ed60-4bf4-8396-801a8eada469");
    expect(source).not.toContain("ddd9f933-04a5-43f0-8673-5933da46cdcb");
  });
});
