import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphApiError } from "../graph/client.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("../graph/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../graph/client.js")>();
  return {
    ...actual,
    graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
  };
});

// ---------------------------------------------------------------------------
// Import after mock
// ---------------------------------------------------------------------------

import { probeServiceHealth, probeAllServices } from "./health.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
});

describe("probeServiceHealth", () => {
  it("returns healthy: true with latency on success", async () => {
    mockGraphRequest.mockResolvedValue({ value: [{ id: "msg-1" }] });

    const result = await probeServiceHealth({
      token: "test-token",
      serviceId: "mail",
      path: "/me/messages?$top=1",
    });

    expect(result.serviceId).toBe("mail");
    expect(result.healthy).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.latencyMs).toBe("number");
  });

  it("returns healthy: false with error on failure", async () => {
    mockGraphRequest.mockRejectedValue(
      new GraphApiError("/me/messages", 500, "Internal Server Error", "InternalServerError"),
    );

    const result = await probeServiceHealth({
      token: "test-token",
      serviceId: "mail",
      path: "/me/messages?$top=1",
    });

    expect(result.serviceId).toBe("mail");
    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("500");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("handles timeout errors gracefully", async () => {
    mockGraphRequest.mockRejectedValue(new Error("The operation was aborted"));

    const result = await probeServiceHealth({
      token: "test-token",
      serviceId: "calendar",
      path: "/me/events?$top=1",
    });

    expect(result.serviceId).toBe("calendar");
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("aborted");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("handles unauthorized errors (token expired)", async () => {
    mockGraphRequest.mockRejectedValue(
      new GraphApiError("/me/messages", 401, "Unauthorized", "InvalidAuthenticationToken"),
    );

    const result = await probeServiceHealth({
      token: "expired-token",
      serviceId: "mail",
      path: "/me/messages?$top=1",
    });

    expect(result.serviceId).toBe("mail");
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("401");
  });
});

describe("probeAllServices", () => {
  it("probes multiple services in parallel", async () => {
    mockGraphRequest
      .mockResolvedValueOnce({ value: [] }) // mail
      .mockRejectedValueOnce(
        new GraphApiError("/me/events", 503, "Service Unavailable", "ServiceUnavailable"),
      ); // calendar

    const results = await probeAllServices({
      token: "test-token",
      services: [
        { id: "mail", probePath: "/me/messages?$top=1" },
        { id: "calendar", probePath: "/me/events?$top=1" },
      ],
    });

    expect(results).toHaveLength(2);

    const mailResult = results.find((r) => r.serviceId === "mail");
    const calResult = results.find((r) => r.serviceId === "calendar");

    expect(mailResult).toBeDefined();
    expect(mailResult!.healthy).toBe(true);

    expect(calResult).toBeDefined();
    expect(calResult!.healthy).toBe(false);
    expect(calResult!.error).toContain("503");

    // Both should have been called (parallel)
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });
});
