/**
 * Triage phase 3 (the deciding half): the per-email review loop.
 *
 * Presents each proposal, collects a verdict, executes approved and
 * corrected actions immediately, and persists everything. Corrections
 * capture what the user chose instead — the raw learning signal.
 *
 * The readline interface is injected so tests can script keypresses.
 */
import type * as readline from "node:readline";
import { prompt, select } from "../cli/prompt-helpers.js";
import type { Correction, ProposedAction, TriageRule, Verdict } from "./rule-types.js";
import { describeAction } from "./rule-types.js";
import type { Proposal } from "./classify.js";
import type { TriageStore } from "./store.js";
import type { ExecutionResult } from "./executor.js";
import { executeAction, FolderResolver } from "./executor.js";

export type ReviewOutcome = {
  proposal: Proposal;
  verdict: Verdict;
  correction?: Correction;
  execution?: ExecutionResult;
};

export type ReviewDeps = {
  rl: readline.Interface;
  store: TriageStore;
  token: string;
  folders: FolderResolver;
  /** Evaluable rules — for trusted-rule auto-act and the correction picker */
  rules: TriageRule[];
  autoAct: boolean;
  defaultForwardTarget?: string;
  out?: (line: string) => void;
};

function findRule(rules: TriageRule[], ruleId: string | null): TriageRule | undefined {
  return ruleId ? rules.find((r) => r.id === ruleId) : undefined;
}

function proposalCard(p: Proposal, index: number, total: number): string {
  const lines = [
    `[${index + 1}/${total}] ${p.envelope.fromName || p.envelope.from} — "${p.envelope.subject || "(no subject)"}"`,
    `    → ${describeAction(p.proposedAction)}  (${p.ruleId ?? "no rule"}, ${p.confidence})`,
    `    why: ${p.rationale}`,
  ];
  if (p.proposedAction.type === "reply_draft") {
    lines.push(`    draft: ${p.proposedAction.draft}`);
  }
  if (p.suggestedRule) {
    lines.push(
      `    suggested rule: "${p.suggestedRule.name}" — ${p.suggestedRule.match}`,
    );
  }
  return lines.join("\n");
}

async function execute(
  p: Proposal,
  action: ProposedAction,
  deps: ReviewDeps,
  onFolderResolved?: (ruleId: string, folderId: string) => void,
): Promise<ExecutionResult> {
  if (action.type === "none") {
    return { ok: true, detail: "left in inbox" };
  }
  const rule = findRule(deps.rules, p.ruleId);
  const cachedFolderId =
    action.type === "move" && rule?.action.type === "move" &&
    rule.action.folder === action.folder
      ? rule.action.folderId
      : undefined;
  return executeAction({
    token: deps.token,
    messageId: p.envelope.id,
    action,
    folders: deps.folders,
    cachedFolderId,
    onFolderResolved:
      p.ruleId && onFolderResolved
        ? (folderId) => onFolderResolved(p.ruleId as string, folderId)
        : undefined,
  });
}

/** Interactive correction flow: what should have happened instead? */
async function collectCorrection(
  deps: ReviewDeps,
): Promise<{ ruleId: string | null; action: ProposedAction } | null> {
  const ruleOptions = deps.rules.filter((r) => r.action.type !== "reply_draft");

  const choice = await select(deps.rl, "What should happen instead?", [
    ...(ruleOptions.length > 0
      ? [{ label: "Apply a different rule", value: "rule" }]
      : []),
    { label: "Move to a folder", value: "move" },
    { label: "Forward to an address", value: "forward" },
    { label: "Flag for follow-up", value: "flag" },
    { label: "Set importance", value: "prioritize" },
    { label: "Leave in inbox (no action)", value: "none" },
    { label: "Cancel", value: "cancel" },
  ]);

  switch (choice) {
    case "rule": {
      const ruleId = await select(
        deps.rl,
        "Which rule?",
        ruleOptions.map((r) => ({
          label: r.name,
          value: r.id,
          description: describeAction(r.action),
        })),
      );
      const rule = ruleOptions.find((r) => r.id === ruleId);
      if (!rule) return null;
      return { ruleId: rule.id, action: rule.action as ProposedAction };
    }
    case "move": {
      const folder = await prompt(
        deps.rl,
        'Folder path (e.g. "Vendors/Invoices"):',
      );
      if (!folder) return null;
      return { ruleId: null, action: { type: "move", folder } };
    }
    case "forward": {
      const to = await prompt(
        deps.rl,
        "Forward to address:",
        deps.defaultForwardTarget,
      );
      if (!to) return null;
      return { ruleId: null, action: { type: "forward", to } };
    }
    case "flag":
      return { ruleId: null, action: { type: "flag" } };
    case "prioritize": {
      const importance = await select(deps.rl, "Importance?", [
        { label: "High", value: "high" },
        { label: "Normal", value: "normal" },
        { label: "Low", value: "low" },
      ]);
      return {
        ruleId: null,
        action: {
          type: "prioritize",
          importance: importance as "low" | "normal" | "high",
        },
      };
    }
    case "none":
      return { ruleId: null, action: { type: "none" } };
    default:
      return null;
  }
}

export type ReviewResult = {
  outcomes: ReviewOutcome[];
  /** ruleId → freshly resolved folderId, for updating the YAML cache */
  folderIdUpdates: Map<string, string>;
};

/**
 * Run the review loop. Trusted+high-confidence proposals auto-execute
 * first when autoAct is on (reply_draft always stays gated); everything
 * else is reviewed one by one.
 */
export async function reviewProposals(
  proposals: Proposal[],
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const outcomes: ReviewOutcome[] = [];
  const folderIdUpdates = new Map<string, string>();
  const onFolderResolved = (ruleId: string, folderId: string) => {
    folderIdUpdates.set(ruleId, folderId);
  };

  // --- Auto-act pass (trusted rules, high confidence, never reply_draft) ---
  const queue: Proposal[] = [];
  for (const p of proposals) {
    const rule = findRule(deps.rules, p.ruleId);
    const autoActable =
      deps.autoAct &&
      rule?.state === "trusted" &&
      p.confidence === "high" &&
      p.proposedAction.type !== "reply_draft" &&
      p.proposedAction.type !== "none";
    if (autoActable) {
      const execution = await execute(p, p.proposedAction, deps, onFolderResolved);
      deps.store.setVerdict(p.decisionId, "auto");
      deps.store.markExecuted(p.decisionId, execution.error);
      outcomes.push({ proposal: p, verdict: "auto", execution });
      out(
        `  ⚡ auto (${p.ruleId}): ${p.envelope.subject || "(no subject)"} → ${execution.detail}` +
          (execution.ok ? "" : ` — FAILED: ${execution.error}`),
      );
    } else {
      queue.push(p);
    }
  }

  // --- Interactive pass ---
  let approveAllHigh = false;
  let quit = false;

  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];

    if (quit) {
      deps.store.setVerdict(p.decisionId, "skipped");
      outcomes.push({ proposal: p, verdict: "skipped" });
      continue;
    }

    const autoApprove =
      approveAllHigh &&
      p.confidence === "high" &&
      p.proposedAction.type !== "reply_draft";

    let answer: string;
    if (autoApprove) {
      answer = "a";
    } else {
      out("");
      out(proposalCard(p, i, queue.length));
      answer = (
        await prompt(
          deps.rl,
          "(a)pprove (r)eject (c)orrect (s)kip (A)pprove all high-confidence (q)uit",
        )
      ).trim();
    }

    if (answer === "A") {
      approveAllHigh = true;
      answer =
        p.confidence === "high" && p.proposedAction.type !== "reply_draft"
          ? "a"
          : "s";
    }

    switch (answer) {
      case "a": {
        const execution = await execute(p, p.proposedAction, deps, onFolderResolved);
        deps.store.setVerdict(p.decisionId, "approved");
        if (p.proposedAction.type !== "none") {
          deps.store.markExecuted(p.decisionId, execution.error);
        }
        outcomes.push({ proposal: p, verdict: "approved", execution });
        out(
          execution.ok
            ? `  ✓ ${execution.detail}`
            : `  ✗ ${execution.detail} FAILED: ${execution.error}`,
        );
        break;
      }
      case "r": {
        deps.store.setVerdict(p.decisionId, "rejected");
        outcomes.push({ proposal: p, verdict: "rejected" });
        out("  ✗ rejected (no action taken)");
        break;
      }
      case "c": {
        const picked = await collectCorrection(deps);
        if (!picked) {
          // Cancelled — re-present the same proposal
          i--;
          continue;
        }
        const note = await prompt(
          deps.rl,
          "Why? (optional note that helps improve the rules)",
          "",
        );
        const correction: Correction = {
          ruleId: picked.ruleId,
          action: picked.action,
          ...(note ? { note } : {}),
        };
        // The corrected action executes immediately — the user gets their
        // outcome now; the correction is recorded as the learning signal.
        const execution = await execute(p, picked.action, deps, onFolderResolved);
        deps.store.setVerdict(p.decisionId, "corrected", correction);
        if (picked.action.type !== "none") {
          deps.store.markExecuted(p.decisionId, execution.error);
        }
        outcomes.push({ proposal: p, verdict: "corrected", correction, execution });
        out(
          execution.ok
            ? `  ↷ corrected: ${execution.detail}`
            : `  ✗ correction ${execution.detail} FAILED: ${execution.error}`,
        );
        break;
      }
      case "q": {
        quit = true;
        deps.store.setVerdict(p.decisionId, "skipped");
        outcomes.push({ proposal: p, verdict: "skipped" });
        break;
      }
      default: {
        // 's' and anything unrecognized
        deps.store.setVerdict(p.decisionId, "skipped");
        outcomes.push({ proposal: p, verdict: "skipped" });
        break;
      }
    }
  }

  return { outcomes, folderIdUpdates };
}
