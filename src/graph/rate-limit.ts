import { GraphApiError } from "./client.js";

export type RetryConfig = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_RETRY: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
};

/** Execute a function with retry logic for Graph API rate limits */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
): Promise<T> {
  const { maxAttempts, initialDelayMs, maxDelayMs } = {
    ...DEFAULT_RETRY,
    ...config,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Only retry on throttling (429)
      if (!(err instanceof GraphApiError) || !err.isThrottled) {
        throw err;
      }

      if (attempt === maxAttempts) {
        throw err;
      }

      // Parse Retry-After header value from error body if available
      let delayMs = initialDelayMs * Math.pow(2, attempt - 1);

      // Add jitter (±10%)
      const jitter = delayMs * 0.1 * (Math.random() * 2 - 1);
      delayMs = Math.min(delayMs + jitter, maxDelayMs);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
