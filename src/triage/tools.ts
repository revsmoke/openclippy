/**
 * Conversational triage tools, exposed to ask/chat sessions so the user
 * can inspect their rules and log corrections without leaving a chat.
 *
 * Verb-last names keep tool-profile suffix matching meaningful:
 * triage_rules_list is read-only-visible (*_list); triage_feedback_create
 * is blocked in read-only (*_create).
 */
import type { AgentTool } from "../services/types.js";
import { getErrorMessage } from "../services/tool-utils.js";
import { describeAction, proposedActionSchema } from "./rule-types.js";
import type { ProposedAction } from "./rule-types.js";
import { loadRules } from "./rules-file.js";
import { TriageStore } from "./store.js";

export function triageRulesListTool(params: {
  rulesPath: string;
  dbPath: string;
}): AgentTool {
  return {
    name: "triage_rules_list",
    description:
      "List the user's email triage rules with their states and accuracy stats.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      try {
        const loaded = await loadRules(params.rulesPath);
        if (loaded.file.rules.length === 0) {
          return {
            content:
              "No triage rules defined yet. Run `openclippy triage init` to bootstrap.",
          };
        }
        const store = new TriageStore(params.dbPath);
        try {
          const accuracy = new Map(
            store.ruleAccuracy().map((r) => [r.ruleId, r]),
          );
          const lines = loaded.file.rules.map((r) => {
            const acc = accuracy.get(r.id);
            const stats = acc
              ? ` | fired ${acc.fired}× (${acc.approved + acc.auto} ok, ${acc.rejected} rejected, ${acc.corrected} corrected)`
              : " | never fired";
            return `- ${r.id} [${r.state}] ${describeAction(r.action)}${stats}\n  ${r.match.trim()}`;
          });
          return {
            content: `Triage rules (${loaded.file.rules.length}):\n${lines.join("\n")}`,
          };
        } finally {
          store.close();
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            content:
              "Triage is not set up yet — no rules file exists. The user can " +
              "run `openclippy triage` to get started.",
          };
        }
        return {
          content: `Error reading triage rules: ${getErrorMessage(err)}`,
          isError: true,
        };
      }
    },
  };
}

export function triageFeedbackCreateTool(params: {
  dbPath: string;
}): AgentTool {
  return {
    name: "triage_feedback_create",
    description:
      "Log a triage correction from conversation — e.g. when the user says " +
      "an email was misfiled or should have been handled differently. The " +
      "correction feeds the next `triage refine`.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Sender address of the email" },
        subject: { type: "string", description: "Subject of the email" },
        note: {
          type: "string",
          description: "What went wrong / what the user wants instead",
        },
        desiredAction: {
          type: "object",
          description:
            "Optional structured action the user wanted, e.g. " +
            '{type:"move", folder:"Vendors/Invoices"} or {type:"flag"}',
        },
        ruleId: {
          type: "string",
          description: "The rule that misfired, if the user identified one",
        },
      },
      required: ["note"],
    },
    execute: async (input) => {
      const note = String(input.note ?? "").trim();
      if (!note) {
        return { content: "Missing required parameter: note", isError: true };
      }

      let action: ProposedAction = { type: "none" };
      if (input.desiredAction) {
        const parsed = proposedActionSchema.safeParse(input.desiredAction);
        if (!parsed.success) {
          return {
            content: `Invalid desiredAction: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
            isError: true,
          };
        }
        action = parsed.data;
      }

      try {
        const store = new TriageStore(params.dbPath);
        try {
          const from = String(input.from ?? "");
          const id = store.insertDecision({
            runId: null,
            messageId: "",
            internetMessageId: null,
            features: {
              from,
              fromDomain: from.includes("@") ? from.split("@")[1] : "",
              subject: String(input.subject ?? ""),
              snippet: "",
              receivedAt: "",
              hasAttachments: false,
              importance: "normal",
            },
            ruleId: typeof input.ruleId === "string" ? input.ruleId : null,
            ruleRevision: null,
            category: "chat-feedback",
            proposedAction: { type: "none" },
            confidence: "high",
            rationale: "User feedback from conversation",
            verdict: "corrected",
            correction: { ruleId: null, action, note },
          });
          return {
            content:
              `Feedback logged (signal #${id}). It will be used the next time ` +
              "the user runs `openclippy triage refine`.",
          };
        } finally {
          store.close();
        }
      } catch (err) {
        return {
          content: `Error logging feedback: ${getErrorMessage(err)}`,
          isError: true,
        };
      }
    },
  };
}
