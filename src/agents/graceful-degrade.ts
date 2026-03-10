import { GraphApiError } from "../graph/client.js";
import type { AgentTool, ToolResult } from "../services/types.js";

/**
 * Wrap a tool's execute function to catch common Graph API errors
 * and return helpful fallback messages instead of crashing.
 *
 * Handled errors:
 * - 401/403 (auth/permission) -> friendly access denied message
 * - 429 (throttled) -> retry suggestion message
 * - Network errors (fetch failures) -> connectivity message
 *
 * Non-degradation errors (404, etc.) pass through unchanged.
 */
export function withGracefulDegradation(tool: AgentTool): AgentTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input, context): Promise<ToolResult> {
      try {
        return await tool.execute(input, context);
      } catch (err) {
        // GraphApiError — handle specific status codes
        if (err instanceof GraphApiError) {
          if (err.isUnauthorized || err.isForbidden) {
            return {
              content: `Access denied for ${tool.name}. Token may have expired or insufficient permissions.`,
              isError: true,
            };
          }

          if (err.isThrottled) {
            return {
              content: "Service is temporarily throttled. Please try again in a moment.",
              isError: true,
            };
          }

          // 404 and other Graph errors pass through
          throw err;
        }

        // Network errors (TypeError: fetch failed, ECONNRESET, etc.)
        if (
          err instanceof TypeError ||
          (err instanceof Error &&
            ("code" in err &&
              typeof (err as NodeJS.ErrnoException).code === "string" &&
              ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].includes(
                (err as NodeJS.ErrnoException).code!,
              )))
        ) {
          return {
            content: `Network error accessing ${tool.name}. Check your connection.`,
            isError: true,
          };
        }

        // All other errors pass through
        throw err;
      }
    },
  };
}
