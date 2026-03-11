import { graphRequest, GraphApiError } from "./client.js";
import type { GraphRequestParams } from "./client.js";

export type RetryOptions = {
  maxRetries?: number; // default 3
  baseDelayMs?: number; // default 1000
  maxDelayMs?: number; // default 30000
};

const RETRYABLE_STATUS_CODES = new Set([429, 503, 504]);

/** Determine whether an error is retryable */
function isRetryable(err: unknown): boolean {
  if (err instanceof GraphApiError) {
    return RETRYABLE_STATUS_CODES.has(err.status);
  }
  // Network errors (ECONNRESET, ETIMEDOUT, fetch failed, etc.)
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return true;
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED") {
      return true;
    }
  }
  return false;
}

/** Compute retry delay for a given attempt */
function computeDelay(
  err: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  // For 429 errors, check for Retry-After metadata
  if (err instanceof GraphApiError && err.isThrottled) {
    if (typeof err.retryAfterSeconds === "number" && err.retryAfterSeconds > 0) {
      return Math.min(err.retryAfterSeconds * 1000, maxDelayMs);
    }
  }

  // Exponential backoff: baseDelay * 2^attempt
  let delayMs = baseDelayMs * Math.pow(2, attempt);

  // Add jitter (+-25%)
  const jitter = delayMs * 0.25 * (Math.random() * 2 - 1);
  delayMs = Math.min(delayMs + jitter, maxDelayMs);

  return Math.max(delayMs, 0);
}

/**
 * Make a Graph API request with automatic retry for transient failures.
 *
 * Handles:
 * - HTTP 429 (throttled) with Retry-After support
 * - HTTP 503 (service unavailable) with exponential backoff
 * - HTTP 504 (gateway timeout) with exponential backoff
 * - Network errors (ECONNRESET, ETIMEDOUT, etc.) with exponential backoff
 *
 * Non-retryable errors (400, 401, 403, 404, etc.) are thrown immediately.
 */
export async function graphRequestWithRetry<T>(
  params: GraphRequestParams,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30_000;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await graphRequest<T>(params);
    } catch (err) {
      lastError = err;

      // If not retryable, throw immediately
      if (!isRetryable(err)) {
        throw err;
      }

      // If this was the last attempt, throw
      if (attempt === maxRetries - 1) {
        throw err;
      }

      // Wait before retrying
      const delayMs = computeDelay(err, attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
