import { vi } from "vitest";
import type { ToolContext } from "../services/types.js";

/**
 * Returns a mock module shape for `vi.mock("../../graph/client.js", graphClientMockFactory)`.
 *
 * NOTE: Due to vitest's `vi.mock()` hoisting, this factory cannot be used
 * directly inside a `vi.mock()` call. Instead, use it as a reference for the
 * mock shape, or import individual pieces (like `createToolContext`) that
 * don't rely on hoisting.
 */
export function graphClientMockFactory() {
  return {
    graphRequest: vi.fn(),
    graphPaginate: vi.fn(),
    GraphApiError: class GraphApiError extends Error {
      constructor(
        public readonly path: string,
        public readonly status: number,
        public readonly body: string,
        public readonly code?: string,
      ) {
        super(`Graph API ${path} failed (${status}): ${body.slice(0, 200)}`);
        this.name = "GraphApiError";
      }

      get isThrottled(): boolean {
        return this.status === 429;
      }

      get isNotFound(): boolean {
        return this.status === 404;
      }

      get isUnauthorized(): boolean {
        return this.status === 401;
      }

      get isForbidden(): boolean {
        return this.status === 403;
      }
    },
  };
}

/**
 * Creates a ToolContext with sensible defaults for tests.
 * Override any field by passing a partial context.
 */
export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    token: "test-token",
    timezone: "America/New_York",
    ...overrides,
  };
}
