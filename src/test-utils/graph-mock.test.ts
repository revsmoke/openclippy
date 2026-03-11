import { describe, it, expect } from "vitest";
import { graphClientMockFactory, createToolContext } from "./graph-mock.js";

// ---------------------------------------------------------------------------
// graphClientMockFactory
// ---------------------------------------------------------------------------

describe("graphClientMockFactory", () => {
  it("returns object with graphRequest, graphPaginate, and GraphApiError", () => {
    const mock = graphClientMockFactory();
    expect(mock).toHaveProperty("graphRequest");
    expect(mock).toHaveProperty("graphPaginate");
    expect(mock).toHaveProperty("GraphApiError");
    expect(typeof mock.graphRequest).toBe("function");
    expect(typeof mock.graphPaginate).toBe("function");
    expect(typeof mock.GraphApiError).toBe("function");
  });

  it("graphRequest and graphPaginate are vi.fn() mocks", () => {
    const mock = graphClientMockFactory();
    // vi.fn() instances have a `mock` property
    expect(mock.graphRequest).toHaveProperty("mock");
    expect(mock.graphPaginate).toHaveProperty("mock");
  });

  describe("mock GraphApiError", () => {
    it("constructs with correct properties", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me/messages", 404, "Not Found", "ErrorItemNotFound");

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("GraphApiError");
      expect(err.path).toBe("/me/messages");
      expect(err.status).toBe(404);
      expect(err.body).toBe("Not Found");
      expect(err.code).toBe("ErrorItemNotFound");
      expect(err.message).toContain("Graph API /me/messages failed (404)");
    });

    it("constructs without optional code parameter", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me", 500, "Server Error");

      expect(err.code).toBeUndefined();
      expect(err.status).toBe(500);
    });

    it("isThrottled returns true for status 429", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me", 429, "Too Many Requests");
      expect(err.isThrottled).toBe(true);
      expect(err.isNotFound).toBe(false);
    });

    it("isNotFound returns true for status 404", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me", 404, "Not Found");
      expect(err.isNotFound).toBe(true);
      expect(err.isThrottled).toBe(false);
    });

    it("isUnauthorized returns true for status 401", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me", 401, "Unauthorized");
      expect(err.isUnauthorized).toBe(true);
      expect(err.isForbidden).toBe(false);
    });

    it("isForbidden returns true for status 403", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me", 403, "Forbidden");
      expect(err.isForbidden).toBe(true);
      expect(err.isUnauthorized).toBe(false);
    });

    it("all getters return false for non-matching status", () => {
      const { GraphApiError } = graphClientMockFactory();
      const err = new GraphApiError("/me", 500, "Internal Server Error");
      expect(err.isThrottled).toBe(false);
      expect(err.isNotFound).toBe(false);
      expect(err.isUnauthorized).toBe(false);
      expect(err.isForbidden).toBe(false);
    });

    it("truncates long body in error message", () => {
      const { GraphApiError } = graphClientMockFactory();
      const longBody = "x".repeat(500);
      const err = new GraphApiError("/me", 500, longBody);
      // Message should contain only first 200 chars of body
      expect(err.message.length).toBeLessThan(300);
    });
  });
});

// ---------------------------------------------------------------------------
// createToolContext
// ---------------------------------------------------------------------------

describe("createToolContext", () => {
  it("returns default context with token and timezone", () => {
    const ctx = createToolContext();
    expect(ctx.token).toBe("test-token");
    expect(ctx.timezone).toBe("America/New_York");
  });

  it("merges overrides into the default context", () => {
    const ctx = createToolContext({ token: "custom-token" });
    expect(ctx.token).toBe("custom-token");
    expect(ctx.timezone).toBe("America/New_York");
  });

  it("allows overriding timezone", () => {
    const ctx = createToolContext({ timezone: "Europe/London" });
    expect(ctx.token).toBe("test-token");
    expect(ctx.timezone).toBe("Europe/London");
  });

  it("allows adding userId", () => {
    const ctx = createToolContext({ userId: "user-1" });
    expect(ctx.token).toBe("test-token");
    expect(ctx.userId).toBe("user-1");
  });

  it("allows overriding all fields", () => {
    const ctx = createToolContext({
      token: "other",
      userId: "u",
      timezone: "UTC",
    });
    expect(ctx.token).toBe("other");
    expect(ctx.userId).toBe("u");
    expect(ctx.timezone).toBe("UTC");
  });

  it("returns no userId by default", () => {
    const ctx = createToolContext();
    expect(ctx.userId).toBeUndefined();
  });
});
