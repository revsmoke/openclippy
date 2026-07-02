/**
 * Chat-session integration: when a rules file exists, ask/chat sessions
 * get (1) contextHints making the agent aware of the user's triage setup
 * and (2) the conversational triage tools, filtered by the active tool
 * profile like every other tool.
 */
import type { AgentTool } from "../services/types.js";
import type { OpenClippyConfig } from "../config/types.base.js";
import type { ToolProfileId } from "../config/types.tools.js";
import { TRIAGE_DB_PATH, TRIAGE_RULES_PATH } from "../config/paths.js";
import { filterToolsByProfile } from "../agents/tool-profiles.js";
import { describeAction } from "./rule-types.js";
import { loadRules } from "./rules-file.js";
import { triageFeedbackCreateTool, triageRulesListTool } from "./tools.js";

export type TriageIntegration = {
  tools: AgentTool[];
  hints: string[];
};

/**
 * Returns empty integration when no rules file exists (triage never used)
 * or the file is unreadable — chat must keep working regardless.
 */
export async function loadTriageIntegration(
  config: OpenClippyConfig,
  profile: ToolProfileId,
): Promise<TriageIntegration> {
  const rulesPath = config.triage?.rulesPath ?? TRIAGE_RULES_PATH;

  let ruleSummaries: string[];
  try {
    const loaded = await loadRules(rulesPath);
    ruleSummaries = loaded.file.rules
      .filter((r) => r.state === "active" || r.state === "trusted")
      .map((r) => `${r.id} (${describeAction(r.action)})`);
  } catch {
    return { tools: [], hints: [] };
  }

  const tools = filterToolsByProfile(
    [
      triageRulesListTool({ rulesPath, dbPath: TRIAGE_DB_PATH }),
      triageFeedbackCreateTool({ dbPath: TRIAGE_DB_PATH }),
    ],
    profile,
  );

  const hints = [
    ruleSummaries.length > 0
      ? `The user has ${ruleSummaries.length} email triage rule(s): ${ruleSummaries.join("; ")}. ` +
        "Use triage_rules_list for details. When the user reports a misfiled " +
        "or mishandled email, log it with triage_feedback_create so the " +
        "triage rules can learn from it."
      : "The user has email triage set up but no active rules yet. When they " +
        "describe how an email should have been handled, log it with " +
        "triage_feedback_create.",
  ];

  return { tools, hints };
}
