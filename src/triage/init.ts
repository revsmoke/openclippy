/**
 * Cold start (`openclippy triage init`):
 *
 *  1. Learn from folder structure — sample recent messages from each
 *     non-default folder and draft one move-rule per folder, batch-approved.
 *  2. Five-question interview — the agent turns the answers into draft
 *     rules, approved individually.
 *
 * Zero rules is a valid outcome: observation mode still logs corrections
 * during review, and refine bootstraps the first rules from them.
 */
import type * as readline from "node:readline";
import { z } from "zod";
import { graphRequestWithRetry } from "../graph/rate-limit.js";
import type { GraphCollectionResponse } from "../graph/client.js";
import type { GraphMailFolder, GraphMessage } from "../services/mail/types.js";
import { buildSystemPrompt } from "../agents/prompt-builder.js";
import { AgentSession } from "../agents/session.js";
import { runAgent } from "../agents/runtime.js";
import type { ModelConfig } from "../agents/model-config.js";
import type { IdentityConfig } from "../config/types.agent.js";
import type { AgentTool } from "../services/types.js";
import { confirm, multiSelect, prompt } from "../cli/prompt-helpers.js";
import { MATCH_MAX_CHARS, describeAction, ruleActionSchema } from "./rule-types.js";
import type { RulesFile, TriageRule } from "./rule-types.js";
import type { LoadedRules } from "./rules-file.js";
import { saveRules } from "./rules-file.js";
import type { TriageStore } from "./store.js";

const DEFAULT_FOLDER_NAMES = new Set([
  "inbox",
  "drafts",
  "sent items",
  "deleted items",
  "junk email",
  "outbox",
  "archive",
  "conversation history",
  "sync issues",
  "rss feeds",
  "clutter",
]);

const MAX_BOOTSTRAP_FOLDERS = 15;
const SAMPLES_PER_FOLDER = 10;

const draftRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  match: z.string().min(1).max(MATCH_MAX_CHARS),
  action: ruleActionSchema,
});
type DraftRule = z.infer<typeof draftRuleSchema>;

function draftCollector(collected: DraftRule[]): AgentTool {
  return {
    name: "triage_rules_draft",
    description:
      "Submit draft triage rules. Call exactly once with all drafts.",
    inputSchema: {
      type: "object",
      properties: {
        rules: {
          type: "array",
          description:
            "Each: {id: lowercase-slug, name, match: natural-language criteria " +
            `(max ${MATCH_MAX_CHARS} chars), action: {type: move|forward|flag|prioritize|categorize, ...}}`,
          items: { type: "object" },
        },
      },
      required: ["rules"],
    },
    execute: async (input) => {
      if (!Array.isArray(input.rules)) {
        return { content: "rules must be an array", isError: true };
      }
      const errors: string[] = [];
      const parsed: DraftRule[] = [];
      input.rules.forEach((raw, i) => {
        const result = draftRuleSchema.safeParse(raw);
        if (result.success) parsed.push(result.data);
        else
          errors.push(
            `rule ${i}: ${result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ")}`,
          );
      });
      if (errors.length > 0) {
        return { content: `Invalid drafts — fix and retry:\n${errors.join("\n")}`, isError: true };
      }
      collected.push(...parsed);
      return { content: `Received ${parsed.length} draft rule(s).` };
    },
  };
}

function toRule(draft: DraftRule, existing: RulesFile, source: string): TriageRule {
  const today = new Date().toISOString().slice(0, 10);
  const maxPriority = Math.max(0, ...existing.rules.map((r) => r.priority));
  return {
    id: draft.id,
    name: draft.name,
    state: "active",
    priority: maxPriority + 10,
    match: draft.match,
    examples: [],
    action: draft.action,
    notes: `Born from ${source} ${today}.`,
    createdAt: today,
    updatedAt: today,
    revision: 1,
  };
}

async function sampleFolder(
  token: string,
  folderId: string,
): Promise<string[]> {
  const response = await graphRequestWithRetry<
    GraphCollectionResponse<GraphMessage>
  >({
    token,
    path:
      `/me/mailFolders/${folderId}/messages?$top=${SAMPLES_PER_FOLDER}` +
      "&$orderby=receivedDateTime desc&$select=subject,from,bodyPreview",
  });
  return (response.value ?? []).map((m) => {
    const from = m.from?.emailAddress?.address ?? "?";
    return `from=${from} subject="${m.subject ?? ""}" preview="${(m.bodyPreview ?? "").slice(0, 120)}"`;
  });
}

const INTERVIEW_QUESTIONS = [
  "Which projects or clients should have their own folder?",
  "Which vendors or services send you bills, invoices, or receipts?",
  "Whose emails are always high priority (VIPs, your manager, key clients)?",
  "Should some mail be forwarded to a group or shared mailbox? Which address(es)?",
  "What makes an email genuinely urgent for you?",
];

export async function runInit(params: {
  token: string;
  modelConfig: ModelConfig;
  identity: IdentityConfig;
  loaded: LoadedRules;
  store: TriageStore;
  rl: readline.Interface;
  out: (line: string) => void;
}): Promise<{ created: number }> {
  const { rl, out, store } = params;
  const working: RulesFile = structuredClone(params.loaded.file);
  const existingIds = new Set(working.rules.map((r) => r.id));
  let created = 0;

  const addApproved = (draft: DraftRule, source: string) => {
    if (existingIds.has(draft.id)) {
      out(`  (skipped "${draft.id}" — id already exists)`);
      return;
    }
    working.rules.push(toRule(draft, working, source));
    existingIds.add(draft.id);
    store.insertRuleEvent({
      ruleId: draft.id,
      revision: 1,
      event: "created",
      actor: "bootstrap",
      newBody: draft.match,
    });
    created++;
  };

  // --- Step 1: learn from folder structure ---
  out("Step 1/2: learning from your folder structure...");
  const folderResponse = await graphRequestWithRetry<
    GraphCollectionResponse<GraphMailFolder>
  >({
    token: params.token,
    path: "/me/mailFolders?$top=100&$select=id,displayName,totalItemCount",
  });
  const candidates = (folderResponse.value ?? [])
    .filter(
      (f) =>
        f.totalItemCount > 0 &&
        !DEFAULT_FOLDER_NAMES.has(f.displayName.toLowerCase()),
    )
    .slice(0, MAX_BOOTSTRAP_FOLDERS);

  if (candidates.length === 0) {
    out("  No custom folders with mail found — skipping folder bootstrap.");
  } else {
    const sections: string[] = [];
    for (const folder of candidates) {
      const samples = await sampleFolder(params.token, folder.id);
      sections.push(
        `Folder "${folder.displayName}" (${folder.totalItemCount} items):\n` +
          samples.map((s) => `  ${s}`).join("\n"),
      );
    }

    const drafts: DraftRule[] = [];
    await runAgent({
      message: [
        "Below are the user's custom mail folders with samples of their contents.",
        "Draft ONE triage rule per folder that captures what belongs there,",
        'with action {type: "move", folder: "<folder name>"}. Use each sample',
        "set to write a precise natural-language match. Call triage_rules_draft once.",
        "",
        ...sections,
      ].join("\n"),
      session: new AgentSession(),
      modelConfig: params.modelConfig,
      tools: [draftCollector(drafts)],
      systemPrompt: buildSystemPrompt({
        identity: params.identity,
        services: [],
        contextHints: [
          "You bootstrap email triage rules from the user's existing folder organization.",
        ],
      }),
      toolContext: { token: "" },
      maxTurns: 3,
    });

    if (drafts.length > 0) {
      const picked = await multiSelect(
        rl,
        "Draft rules from your folders — pick the ones to keep:",
        drafts.map((d) => ({
          label: `${d.name}: ${describeAction(d.action)}`,
          value: d.id,
          description: d.match.slice(0, 100),
          selected: true,
        })),
      );
      const chosen = new Set(picked);
      for (const draft of drafts) {
        if (chosen.has(draft.id)) addApproved(draft, "folder bootstrap");
      }
    } else {
      out("  The agent produced no folder-based drafts.");
    }
  }

  // --- Step 2: interview ---
  out("");
  out("Step 2/2: a few questions (Enter to skip any):");
  const answers: string[] = [];
  for (const q of INTERVIEW_QUESTIONS) {
    const a = await prompt(rl, q, "");
    if (a) answers.push(`Q: ${q}\nA: ${a}`);
  }

  if (answers.length > 0) {
    const drafts: DraftRule[] = [];
    await runAgent({
      message: [
        "Draft email triage rules from this interview. One rule per distinct",
        "need; prefer move/forward/flag/prioritize actions. Call",
        "triage_rules_draft once with all drafts.",
        "",
        ...answers,
      ].join("\n\n"),
      session: new AgentSession(),
      modelConfig: params.modelConfig,
      tools: [draftCollector(drafts)],
      systemPrompt: buildSystemPrompt({
        identity: params.identity,
        services: [],
        contextHints: [
          "You bootstrap email triage rules from a short user interview.",
        ],
      }),
      toolContext: { token: "" },
      maxTurns: 3,
    });

    for (const draft of drafts) {
      out("");
      out(`Rule "${draft.name}" — ${describeAction(draft.action)}`);
      out(`  ${draft.match}`);
      const yes = await confirm(rl, "Keep this rule?", true);
      if (yes) addApproved(draft, "interview");
    }
  }

  if (created > 0) {
    await saveRules(params.loaded, working);
    out("");
    out(`Created ${created} rule(s) in ${params.loaded.path}.`);
  } else {
    out("");
    out(
      "No rules created — that's fine. Run `openclippy triage` and correct " +
        "its proposals; refine will draft rules from your corrections.",
    );
  }
  return { created };
}
