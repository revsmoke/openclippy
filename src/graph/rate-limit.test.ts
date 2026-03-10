import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphApiError } from "./client.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
  };
});

// ---------------------------------------------------------------------------
// Import after mock
// ---------------------------------------------------------------------------

import { graphRequestWithRetry } from "./rate-limit.js";
import type { GraphRequestParams } from "./client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseParams: GraphRequestParams = {
  token: "test-token",
  path: "/me/messages",
};

function make429(retryAfter?: number): GraphApiError {
  const err = new GraphApiError(
    "/me/messages",
    429,
    JSON.stringify({ error: { code: "TooManyRequests", message: "Throttled" } }),
    "TooManyRequests",
  );
  // Attach retryAfter metadata for the retry handler to read
  if (retryAfter !== undefined) {
    (err as unknown as Record<string, unknown>).retryAfterSeconds = retryAfter;
  }
  return err;
}

function make503(): GraphApiError {
  return new GraphApiError(
    "/me/messages",
    503,
    JSON.stringify({ error: { code: "ServiceUnavailable", message: "Try again" } }),
    "ServiceUnavailable",
  );
}

function make504(): GraphApiError {
  return new GraphApiError(
    "/me/messages",
    504,
    JSON.stringify({ error: { code: "GatewayTimeout", message: "Timeout" } }),
    "GatewayTimeout",
  );
}

function makeNetworkError(): TypeError {
  return new TypeError("fetch failed");
}

function make400(): GraphApiError {
  return new GraphApiError(
    "/me/messages",
    400,
    JSON.stringify({ error: { code: "BadRequest", message: "Invalid" } }),
    "BadRequest",
  );
}

function make404(): GraphApiError {
  return new GraphApiError(
    "/me/messages/invalid",
    404,
    JSON.stringify({ error: { code: "ResourceNotFound", message: "Not found" } }),
    "ResourceNotFound",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("graphRequestWithRetry", () => {
  it("returns result on success (no retry needed)", async () => {
    mockGraphRequest.mockResolvedValue({ value: [{ id: "1" }] });

    const result = await graphRequestWithRetry(baseParams);

    expect(result).toEqual({ value: [{ id: "1" }] });
    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 with Retry-After header", async () => {
    mockGraphRequest
      .mockRejectedValueOnce(make429(2))
      .mockResolvedValue({ ok: true });

    const promise = graphRequestWithRetry(baseParams, {
      baseDelayMs: 100,
    });

    // Advance timers past the retry-after delay
    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 with exponential backoff", async () => {
    mockGraphRequest
      .mockRejectedValueOnce(make503())
      .mockResolvedValue({ ok: true });

    const promise = graphRequestWithRetry(baseParams, {
      baseDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });

  it("retries on 504 with exponential backoff", async () => {
    mockGraphRequest
      .mockRejectedValueOnce(make504())
      .mockResolvedValue({ ok: true });

    const promise = graphRequestWithRetry(baseParams, {
      baseDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });

  it("retries on network error (fetch failed)", async () => {
    mockGraphRequest
      .mockRejectedValueOnce(makeNetworkError())
      .mockResolvedValue({ ok: true });

    const promise = graphRequestWithRetry(baseParams, {
      baseDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });

  it("throws original error after max retries exceeded", async () => {
    vi.useRealTimers();
    mockGraphRequest
      .mockRejectedValueOnce(make503())
      .mockRejectedValueOnce(make503())
      .mockRejectedValueOnce(make503());

    await expect(
      graphRequestWithRetry(baseParams, {
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
      }),
    ).rejects.toThrow(GraphApiError);
    expect(mockGraphRequest).toHaveBeenCalledTimes(3);
  });

  it("succeeds after 1 retry", async () => {
    mockGraphRequest
      .mockRejectedValueOnce(make503())
      .mockResolvedValue({ data: "ok" });

    const promise = graphRequestWithRetry(baseParams, {
      baseDelayMs: 50,
    });

    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toEqual({ data: "ok" });
    expect(mockGraphRequest).toHaveBeenCalledTimes(2);
  });

  it("succeeds after 2 retries", async () => {
    vi.useRealTimers();
    mockGraphRequest
      .mockRejectedValueOnce(make503())
      .mockRejectedValueOnce(make504())
      .mockResolvedValueOnce({ data: "recovered" });

    const result = await graphRequestWithRetry(baseParams, {
      baseDelayMs: 1,
      maxDelayMs: 5,
    });

    expect(result).toEqual({ data: "recovered" });
    expect(mockGraphRequest).toHaveBeenCalledTimes(3);
  });

  it("honors maxRetries option", async () => {
    mockGraphRequest.mockRejectedValueOnce(make503());

    const promise = graphRequestWithRetry(baseParams, {
      maxRetries: 1,
      baseDelayMs: 50,
    });

    await expect(promise).rejects.toThrow(GraphApiError);
    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 400 (non-retryable)", async () => {
    mockGraphRequest.mockRejectedValue(make400());

    await expect(
      graphRequestWithRetry(baseParams),
    ).rejects.toThrow(GraphApiError);

    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 404 (non-retryable)", async () => {
    mockGraphRequest.mockRejectedValue(make404());

    await expect(
      graphRequestWithRetry(baseParams),
    ).rejects.toThrow(GraphApiError);

    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
  });
});
