import type { ToolProfileId } from "../config/types.tools.js";
import type { AgentTool } from "../services/types.js";

/**
 * Profile rules define which tool name suffixes are allowed or blocked.
 *
 * Patterns use suffix matching:
 *   "*_list"  matches any tool whose name ends in "_list"
 *   "*"       matches all tools
 *
 * Blocked patterns take precedence over allowed patterns.
 */
type ProfileRule = {
  allowed: string[];
  blocked: string[];
};

const PROFILE_RULES: Record<ToolProfileId, ProfileRule> = {
  "read-only": {
    allowed: [
      "*_list",
      "*_read",
      "*_search",
      "*_tasks",
      "*_folders",
      "*_freebusy",
      "*_lists",
    ],
    blocked: [
      "*_send",
      "*_delete",
      "*_create",
      "*_update",
      "*_move",
      "*_flag",
      "*_draft",
      "*_reply",
      "*_forward",
      "*_accept",
      "*_decline",
      "*_complete",
    ],
  },
  standard: {
    allowed: ["*"],
    blocked: ["*_delete"],
  },
  full: {
    allowed: ["*"],
    blocked: [],
  },
  admin: {
    allowed: ["*"],
    blocked: [],
  },
};

/**
 * Check whether a tool name matches a suffix pattern.
 * Pattern "*_list" matches "mail_list", "todo_list", etc.
 * Pattern "*" matches everything.
 */
function matchesPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  // Pattern is "*_suffix" — extract suffix and check
  const suffix = pattern.slice(1); // drop the leading "*"
  return toolName.endsWith(suffix);
}

function matchesAnyPattern(toolName: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(toolName, p));
}

/**
 * Filter tools by profile. A tool passes if:
 *   1. It is NOT matched by any blocked pattern, AND
 *   2. It IS matched by at least one allowed pattern.
 */
export function filterToolsByProfile(
  tools: AgentTool[],
  profile: ToolProfileId,
): AgentTool[] {
  const rules = PROFILE_RULES[profile];
  if (!rules) {
    throw new Error(`Unknown tool profile: ${profile}`);
  }

  return tools.filter((tool) => {
    // Blocked takes precedence
    if (rules.blocked.length > 0 && matchesAnyPattern(tool.name, rules.blocked)) {
      return false;
    }
    // Must match at least one allowed pattern
    return matchesAnyPattern(tool.name, rules.allowed);
  });
}
