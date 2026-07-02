/**
 * The learning loop: distill logged rejections/corrections into
 * human-approved rule changes.
 *
 * Two entry points:
 *  - proposeMicroEdit: right after a correction, draft ONE minimal edit
 *    to the contradicted rule's match text (typically an exclusion).
 *  - runRefine: batch pass over all undistilled signals — cluster,
 *    generate edit/new/retire/merge proposals via a collector tool,
 *    present each as a diff, apply only what the user approves.
 *
 * Anti-drift guardrails: every mutation is a user-approved diff backed by
 * decision-id evidence; refine may only touch rules implicated by that
 * evidence; match text stays under MATCH_MAX_CHARS; examples cap at 5.
 */
import type * as readline from "node:readline";
import { z } from "zod";
import { buildSystemPrompt } from "../agents/prompt-builder.js";
import { AgentSession } from "../agents/session.js";
import { runAgent } from "../agents/runtime.js";
import type { ModelConfig } from "../agents/model-config.js";
import type { IdentityConfig } from "../config/types.agent.js";
import type { AgentTool } from "../services/types.js";
import { prompt, confirm } from "../cli/prompt-helpers.js";
import {
  MATCH_MAX_CHARS,
  MAX_EXAMPLES_PER_RULE,
  describeAction,
  ruleActionSchema,
  ruleExampleSchema,
} from "./rule-types.js";
import type { RulesFile, TriageRule } from "./rule-types.js";
import type { DecisionRow, TriageStore } from "./store.js";
import type { LoadedRules } from "./rules-file.js";
import { saveRules } from "./rules-file.js";
import {
  applyLifecycleChange,
  checkPromotions,
  checkRetirements,
} from "./lifecycle.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Simple line diff for match-text changes. */
export function renderMatchDiff(oldText: string, newText: string): string {
  const oldLines = oldText.trim().split("\n");
  const newLines = newText.trim().split("\n");
  return [
    ...oldLines.map((l) => `  - ${l}`),
    ...newLines.map((l) => `  + ${l}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Micro-learning: one minimal edit right after a correction
// ---------------------------------------------------------------------------

const microEditSchema = z.object({
  newMatch: z.string().min(1).max(MATCH_MAX_CHARS),
});

/**
 * Ask the agent for ONE minimal edit to the rule's match text that would
 * have prevented this misfire. Returns null when the agent declines
 * (or produces nothing usable). Never touches other rules.
 */
export async function proposeMicroEdit(params: {
  rule: TriageRule;
  decision: DecisionRow;
  modelConfig: ModelConfig;
  identity: IdentityConfig;
}): Promise<string | null> {
  let proposed: string | null = null;

  const collector: AgentTool = {
    name: "triage_rule_edit",
    description:
      "Propose the minimal edit to the rule's match text. Call at most once.",
    inputSchema: {
      type: "object",
      properties: {
        newMatch: {
          type: "string",
          description: `Full replacement match text (max ${MATCH_MAX_CHARS} chars)`,
        },
      },
      required: ["newMatch"],
    },
    execute: async (input) => {
      const parsed = microEditSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid edit: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
          isError: true,
        };
      }
      proposed = parsed.data.newMatch;
      return { content: "Edit recorded." };
    },
  };

  const correction = params.decision.correction;
  const message = [
    `The triage rule "${params.rule.id}" misfired and the user corrected it.`,
    "",
    `Rule match text: ${params.rule.match.trim()}`,
    `Rule action: ${describeAction(params.rule.action)}`,
    "",
    `Email: from=${params.decision.features.from} subject="${params.decision.features.subject}"`,
    `Snippet: ${params.decision.features.snippet}`,
    `Rule proposed: ${describeAction(params.decision.proposedAction)}`,
    correction
      ? `User corrected to: ${describeAction(correction.action)}${correction.note ? ` — note: "${correction.note}"` : ""}`
      : "User rejected the proposal.",
    "",
    "Propose ONE minimal edit to the match text (typically adding an " +
      "exclusion clause) that would have prevented this misfire while " +
      "keeping the rule's intent. If no small edit would help, reply with " +
      "text only and do not call the tool.",
  ].join("\n");

  await runAgent({
    message,
    session: new AgentSession(),
    modelConfig: params.modelConfig,
    tools: [collector],
    systemPrompt: buildSystemPrompt({
      identity: params.identity,
      services: [],
      contextHints: [
        "You maintain the user's email triage rules. Edits must be minimal and surgical.",
      ],
    }),
    toolContext: { token: "" },
    maxTurns: 2,
  });

  return proposed !== null && proposed !== params.rule.match ? proposed : null;
}

/**
 * Present a micro-edit as a diff and, if approved (or user-edited),
 * apply it to the working rules file. Returns true when applied.
 */
export async function reviewMicroEdit(params: {
  rl: readline.Interface;
  rule: TriageRule;
  newMatch: string;
  decisionId: number;
  file: RulesFile;
  store: TriageStore;
  out: (line: string) => void;
}): Promise<boolean> {
  const { rl, rule, out } = params;
  out("");
  out(`Suggested update to rule "${rule.id}" based on your correction:`);
  out(renderMatchDiff(rule.match, params.newMatch));
  const answer = (
    await prompt(rl, "Apply this update? (y)es (n)o (e)dit", "n")
  ).trim();

  let finalMatch: string | null = null;
  if (answer === "y") {
    finalMatch = params.newMatch;
  } else if (answer === "e") {
    const edited = await prompt(rl, "New match text:", params.newMatch);
    if (edited && edited.length <= MATCH_MAX_CHARS) finalMatch = edited;
    else if (edited) out(`Too long (max ${MATCH_MAX_CHARS} chars) — skipped.`);
  }
  if (!finalMatch || finalMatch === rule.match) return false;

  const oldMatch = rule.match;
  rule.match = finalMatch;
  rule.revision += 1;
  rule.updatedAt = todayIso();
  params.store.insertRuleEvent({
    ruleId: rule.id,
    revision: rule.revision,
    event: "edited",
    actor: "agent",
    oldBody: oldMatch,
    newBody: finalMatch,
    evidence: [params.decisionId],
  });
  return true;
}

// ---------------------------------------------------------------------------
// Batch refine
// ---------------------------------------------------------------------------

const refineProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("edit"),
    ruleId: z.string(),
    newMatch: z.string().min(1).max(MATCH_MAX_CHARS),
    addExample: ruleExampleSchema.optional(),
    evidence: z.array(z.number()).min(1),
    rationale: z.string().min(1),
  }),
  z.object({
    kind: z.literal("new"),
    rule: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      name: z.string().min(1),
      match: z.string().min(1).max(MATCH_MAX_CHARS),
      action: ruleActionSchema,
      hints: z
        .object({
          domains: z.array(z.string()).default([]),
          senders: z.array(z.string()).default([]),
        })
        .optional(),
    }),
    evidence: z.array(z.number()).min(1),
    rationale: z.string().min(1),
  }),
  z.object({
    kind: z.literal("retire"),
    ruleId: z.string(),
    evidence: z.array(z.number()).default([]),
    rationale: z.string().min(1),
  }),
  z.object({
    kind: z.literal("merge"),
    ruleId: z.string(),
    mergeInto: z.string(),
    evidence: z.array(z.number()).default([]),
    rationale: z.string().min(1),
  }),
]);
type RefineProposal = z.infer<typeof refineProposalSchema>;

function signalSummary(d: DecisionRow): string {
  const parts = [
    `#${d.id}`,
    `from=${d.features.from}`,
    `subject="${d.features.subject}"`,
    d.ruleId ? `rule=${d.ruleId}` : "rule=none",
    `proposed=${describeAction(d.proposedAction)}`,
    `verdict=${d.verdict}`,
  ];
  if (d.correction) {
    parts.push(`corrected-to=${describeAction(d.correction.action)}`);
    if (d.correction.ruleId) parts.push(`corrected-rule=${d.correction.ruleId}`);
    if (d.correction.note) parts.push(`note="${d.correction.note}"`);
  }
  if (d.suggestedRule) {
    parts.push(`suggested-rule="${d.suggestedRule.name}: ${d.suggestedRule.match}"`);
  }
  return parts.join(" | ");
}

function buildRefineMessage(
  signals: DecisionRow[],
  rules: TriageRule[],
): string {
  const misfires = signals.filter((s) => s.ruleId !== null);
  const unmatched = signals.filter((s) => s.ruleId === null);

  const byRule = new Map<string, DecisionRow[]>();
  for (const m of misfires) {
    const list = byRule.get(m.ruleId as string) ?? [];
    list.push(m);
    byRule.set(m.ruleId as string, list);
  }

  const lines: string[] = [
    "Improve the user's email triage rules based on the correction signals below.",
    "",
    "Current rules:",
    ...rules.map(
      (r) =>
        `- ${r.id} [${r.state}, rev ${r.revision}]: ${r.match.trim()} → ${describeAction(r.action)}`,
    ),
    "",
  ];

  if (byRule.size > 0) {
    lines.push("Misfires (grouped by rule):");
    for (const [ruleId, list] of byRule) {
      lines.push(`Rule ${ruleId}:`);
      for (const d of list) lines.push(`  ${signalSummary(d)}`);
    }
    lines.push("");
  }
  if (unmatched.length > 0) {
    lines.push("Corrections on emails no rule matched:");
    for (const d of unmatched) lines.push(`  ${signalSummary(d)}`);
    lines.push("");
  }

  lines.push(
    "Call triage_rules_propose once with your proposals. Guidelines:",
    "- 'edit': ONE minimal rewrite of a misfiring rule's match text " +
      "(usually an exclusion clause); optionally add one example.",
    `- 'new': only when ≥3 signals show the same pattern; match ≤ ${MATCH_MAX_CHARS} chars.`,
    "- 'retire' / 'merge': only with clear evidence (persistent overlap or dead weight).",
    "- Every proposal must cite the signal ids (the #numbers) as evidence.",
    "- Only touch rules implicated by the evidence. Fewer, better proposals win.",
  );
  return lines.join("\n");
}

export type RefineSummary = {
  signals: number;
  proposals: number;
  applied: number;
  lifecycleApplied: number;
};

/**
 * The `openclippy triage refine` flow. Reads undistilled signals, has the
 * agent draft proposals, presents each as a diff for approve/edit/reject,
 * applies approved ones atomically (with .bak), advances the watermark,
 * then runs the promotion/retirement check.
 */
export async function runRefine(params: {
  store: TriageStore;
  loaded: LoadedRules;
  modelConfig: ModelConfig;
  identity: IdentityConfig;
  rl: readline.Interface;
  out: (line: string) => void;
}): Promise<RefineSummary> {
  const { store, rl, out } = params;
  const signals = store.undistilledSignals();
  const summary: RefineSummary = {
    signals: signals.length,
    proposals: 0,
    applied: 0,
    lifecycleApplied: 0,
  };

  // Work on a deep copy so rejected proposals leave no trace
  const working: RulesFile = structuredClone(params.loaded.file);
  let dirty = false;

  if (signals.length > 0) {
    let collected: RefineProposal[] = [];
    const collector: AgentTool = {
      name: "triage_rules_propose",
      description:
        "Submit rule-improvement proposals. Call exactly once with all proposals.",
      inputSchema: {
        type: "object",
        properties: {
          proposals: {
            type: "array",
            description:
              "Each: {kind: edit|new|retire|merge, ...} — see the task message for required fields per kind.",
            items: { type: "object" },
          },
        },
        required: ["proposals"],
      },
      execute: async (input) => {
        const arr = input.proposals;
        if (!Array.isArray(arr)) {
          return { content: "proposals must be an array", isError: true };
        }
        const parsed: RefineProposal[] = [];
        const errors: string[] = [];
        arr.forEach((raw, i) => {
          const result = refineProposalSchema.safeParse(raw);
          if (result.success) parsed.push(result.data);
          else
            errors.push(
              `proposal ${i}: ${result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ")}`,
            );
        });
        if (errors.length > 0) {
          return { content: `Invalid proposals — fix and retry:\n${errors.join("\n")}`, isError: true };
        }
        collected = parsed;
        return { content: `Received ${parsed.length} proposal(s).` };
      },
    };

    await runAgent({
      message: buildRefineMessage(signals, working.rules),
      session: new AgentSession(),
      modelConfig: params.modelConfig,
      tools: [collector],
      systemPrompt: buildSystemPrompt({
        identity: params.identity,
        services: [],
        contextHints: [
          "You maintain the user's email triage rules. Propose minimal, evidence-backed changes only.",
        ],
      }),
      toolContext: { token: "" },
      maxTurns: 3,
    });

    summary.proposals = collected.length;
    if (collected.length === 0) {
      out("No rule changes proposed from the current signals.");
    }

    const signalIds = new Set(signals.map((s) => s.id));

    for (const proposal of collected) {
      // Guardrail: refine may only cite logged evidence
      const evidence = proposal.evidence.filter((id) => signalIds.has(id));
      if (evidence.length === 0 && proposal.kind !== "retire") {
        out(`  (skipped a ${proposal.kind} proposal with no valid evidence)`);
        continue;
      }

      const applied = await presentProposal(proposal, evidence, working, params);
      if (applied) {
        summary.applied++;
        dirty = true;
      }
    }
  } else {
    out("No new correction signals since the last refine.");
  }

  // --- Promotion / retirement check ---
  const lifecycle = [
    ...checkPromotions(store, working),
    ...checkRetirements(store, working),
  ];
  for (const change of lifecycle) {
    out("");
    out(
      `Rule "${change.ruleId}": ${change.from} → ${change.to} (${change.reason})`,
    );
    const yes = await confirm(rl, "Apply this change?", change.to === "trusted");
    if (yes && applyLifecycleChange(change, working, store)) {
      summary.lifecycleApplied++;
      dirty = true;
    }
  }

  // --- Persist ---
  if (dirty) {
    await saveRules(params.loaded, working, { backup: true });
    out("");
    out(`Rules saved (previous version kept at ${params.loaded.path}.bak).`);
  }
  if (signals.length > 0) {
    store.markDistilled(signals.map((s) => s.id));
    store.setMeta(
      "refine_watermark",
      String(Math.max(...signals.map((s) => s.id))),
    );
  }

  return summary;
}

/** Present one proposal as a diff; apply to the working file if approved. */
async function presentProposal(
  proposal: RefineProposal,
  evidence: number[],
  working: RulesFile,
  params: {
    store: TriageStore;
    rl: readline.Interface;
    out: (line: string) => void;
  },
): Promise<boolean> {
  const { rl, out, store } = params;
  const evidenceNote = evidence.length > 0 ? ` [evidence: ${evidence.map((e) => `#${e}`).join(", ")}]` : "";
  out("");

  switch (proposal.kind) {
    case "edit": {
      const rule = working.rules.find((r) => r.id === proposal.ruleId);
      if (!rule) return false;
      out(`EDIT rule "${rule.id}": ${proposal.rationale}${evidenceNote}`);
      out(renderMatchDiff(rule.match, proposal.newMatch));
      const answer = (
        await prompt(rl, "(a)pprove (e)dit (r)eject", "r")
      ).trim();
      let finalMatch: string | null = null;
      if (answer === "a") finalMatch = proposal.newMatch;
      else if (answer === "e") {
        const edited = await prompt(rl, "New match text:", proposal.newMatch);
        if (edited && edited.length <= MATCH_MAX_CHARS) finalMatch = edited;
      }
      if (!finalMatch || finalMatch === rule.match) return false;

      const oldMatch = rule.match;
      rule.match = finalMatch;
      if (
        proposal.addExample &&
        rule.examples.length < MAX_EXAMPLES_PER_RULE
      ) {
        rule.examples.push(proposal.addExample);
      }
      rule.revision += 1;
      rule.updatedAt = todayIso();
      store.insertRuleEvent({
        ruleId: rule.id,
        revision: rule.revision,
        event: "edited",
        actor: "refine",
        oldBody: oldMatch,
        newBody: finalMatch,
        evidence,
      });
      return true;
    }

    case "new": {
      if (working.rules.some((r) => r.id === proposal.rule.id)) {
        out(`  (skipped: rule id "${proposal.rule.id}" already exists)`);
        return false;
      }
      out(`NEW rule "${proposal.rule.id}": ${proposal.rationale}${evidenceNote}`);
      out(`  + match: ${proposal.rule.match}`);
      out(`  + action: ${describeAction(proposal.rule.action)}`);
      const yes = await confirm(rl, "Create this rule?", false);
      if (!yes) return false;

      const maxPriority = Math.max(
        0,
        ...working.rules.map((r) => r.priority),
      );
      working.rules.push({
        id: proposal.rule.id,
        name: proposal.rule.name,
        state: "active",
        priority: maxPriority + 10,
        match: proposal.rule.match,
        hints: proposal.rule.hints,
        examples: [],
        action: proposal.rule.action,
        notes: `Born from refine ${todayIso()} (${evidence.length} signal(s)).`,
        createdAt: todayIso(),
        updatedAt: todayIso(),
        revision: 1,
      });
      store.insertRuleEvent({
        ruleId: proposal.rule.id,
        revision: 1,
        event: "created",
        actor: "refine",
        newBody: proposal.rule.match,
        evidence,
      });
      return true;
    }

    case "retire": {
      const rule = working.rules.find((r) => r.id === proposal.ruleId);
      if (!rule || rule.state === "retired") return false;
      out(`RETIRE rule "${rule.id}": ${proposal.rationale}${evidenceNote}`);
      const yes = await confirm(rl, "Retire this rule?", false);
      if (!yes) return false;
      rule.state = "retired";
      rule.updatedAt = todayIso();
      store.insertRuleEvent({
        ruleId: rule.id,
        revision: rule.revision,
        event: "retired",
        actor: "refine",
        evidence,
      });
      return true;
    }

    case "merge": {
      const source = working.rules.find((r) => r.id === proposal.ruleId);
      const target = working.rules.find((r) => r.id === proposal.mergeInto);
      if (!source || !target || source.id === target.id) return false;
      out(
        `MERGE rule "${source.id}" into "${target.id}": ${proposal.rationale}${evidenceNote}`,
      );
      const yes = await confirm(rl, "Merge (retires the source rule)?", false);
      if (!yes) return false;
      source.state = "retired";
      source.updatedAt = todayIso();
      source.notes = `Merged into ${target.id} on ${todayIso()}.`;
      store.insertRuleEvent({
        ruleId: source.id,
        revision: source.revision,
        event: "merged",
        actor: "refine",
        evidence: { mergedInto: target.id, decisions: evidence },
      });
      return true;
    }
  }
}
