import { describe, it, expect, vi, afterEach } from "vitest";
import { graphRequest, GraphApiError, graphBatch } from "./client.js";

describe("graphRequest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("makes authenticated GET request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ value: [{ id: "1", subject: "Test" }] }),
    });

    const result = await graphRequest<{ value: unknown[] }>({
      token: "test-token",
      path: "/me/messages",
    });

    expect(result.value).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/messages",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("throws GraphApiError on non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":{"code":"ResourceNotFound","message":"Not found"}}'),
    });

    await expect(
      graphRequest({ token: "test-token", path: "/me/messages/invalid" }),
    ).rejects.toThrow(GraphApiError);
  });

  it("returns undefined for 204 No Content", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await graphRequest({ token: "test-token", path: "/me/messages/1", method: "DELETE" });
    expect(result).toBeUndefined();
  });

  it("passes raw body when Content-Type is not JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "file-1", name: "test.txt" }),
    });

    await graphRequest({
      token: "t",
      path: "/me/drive/root:/test.txt:/content",
      method: "PUT",
      body: "Hello, world!",
      headers: { "Content-Type": "application/octet-stream" },
    });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // Body should be the raw string, not JSON-stringified (which would add quotes)
    expect(callArgs[1].body).toBe("Hello, world!");
  });

  it("JSON-stringifies body when Content-Type is JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "msg-1" }),
    });

    await graphRequest({
      token: "t",
      path: "/me/messages",
      method: "POST",
      body: { subject: "Test" },
    });

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].body).toBe('{"subject":"Test"}');
  });

  it("uses beta endpoint when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await graphRequest({ token: "t", path: "/me/messages", version: "beta" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://graph.microsoft.com/beta/me/messages",
      expect.anything(),
    );
  });
});

describe("GraphApiError", () => {
  it("detects throttled responses", () => {
    const err = new GraphApiError("/me/messages", 429, "Too Many Requests");
    expect(err.isThrottled).toBe(true);
    expect(err.isNotFound).toBe(false);
  });

  it("detects not found responses", () => {
    const err = new GraphApiError("/me/messages/1", 404, "Not Found");
    expect(err.isNotFound).toBe(true);
  });

  it("detects unauthorized responses", () => {
    const err = new GraphApiError("/me/messages", 401, "Unauthorized");
    expect(err.isUnauthorized).toBe(true);
  });
});

describe("graphBatch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects more than 20 requests", async () => {
    const requests = Array.from({ length: 21 }, (_, i) => ({
      id: String(i),
      method: "GET" as const,
      url: `/me/messages/${i}`,
    }));

    await expect(
      graphBatch({ token: "t", requests }),
    ).rejects.toThrow("maximum of 20");
  });
});
