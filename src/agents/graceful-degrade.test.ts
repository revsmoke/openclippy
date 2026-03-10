import { describe, it, expect } from "vitest";
import { GraphApiError } from "../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../services/types.js";
import { withGracefulDegradation } from "./graceful-degrade.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ctx: ToolContext = { token: "test-token" };

function makeTool(
  executeFn: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>,
): AgentTool {
  return {
    name: "test_tool",
    description: "A test tool for graceful degradation",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: executeFn,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withGracefulDegradation", () => {
  it("passes through normal execution unchanged", async () => {
    const tool = makeTool(async () => ({ content: "success" }));
    const wrapped = withGracefulDegradation(tool);

    const result = await wrapped.execute({ query: "test" }, ctx);

    expect(result.content).toBe("success");
    expect(result.isError).toBeUndefined();
  });

  it("returns helpful auth message on 401 error", async () => {
    const tool = makeTool(async () => {
      throw new GraphApiError("/me/messages", 401, "Unauthorized", "InvalidAuthenticationToken");
    });
    const wrapped = withGracefulDegradation(tool);

    const result = await wrapped.execute({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Access denied");
    expect(result.content).toContain("test_tool");
    expect(result.content).toContain("expired");
  });

  it("returns helpful permission message on 403 error", async () => {
    const tool = makeTool(async () => {
      throw new GraphApiError("/me/messages", 403, "Forbidden", "Authorization_RequestDenied");
    });
    const wrapped = withGracefulDegradation(tool);

    const result = await wrapped.execute({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Access denied");
    expect(result.content).toContain("test_tool");
    expect(result.content).toContain("permissions");
  });

  it("returns throttle message on 429 error", async () => {
    const tool = makeTool(async () => {
      throw new GraphApiError("/me/messages", 429, "Too Many Requests", "TooManyRequests");
    });
    const wrapped = withGracefulDegradation(tool);

    const result = await wrapped.execute({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("throttled");
  });

  it("passes through 404 error (not caught)", async () => {
    const tool = makeTool(async () => {
      throw new GraphApiError("/me/messages/invalid", 404, "Not Found", "ResourceNotFound");
    });
    const wrapped = withGracefulDegradation(tool);

    await expect(wrapped.execute({ query: "test" }, ctx)).rejects.toThrow(GraphApiError);
  });

  it("returns connection message on network error", async () => {
    const tool = makeTool(async () => {
      throw new TypeError("fetch failed");
    });
    const wrapped = withGracefulDegradation(tool);

    const result = await wrapped.execute({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Network error");
    expect(result.content).toContain("connection");
  });

  it("preserves original tool metadata (name, description, inputSchema)", () => {
    const tool = makeTool(async () => ({ content: "ok" }));
    const wrapped = withGracefulDegradation(tool);

    expect(wrapped.name).toBe("test_tool");
    expect(wrapped.description).toBe("A test tool for graceful degradation");
    expect(wrapped.inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    });
  });
});
