/**
 * Orchestrates one `openclippy triage` run:
 *
 *   fetch (deterministic) → classify (read-only agent) → review + execute
 *   (user-gated) → post-review learning (demotions, micro-edits, folder
 *   id cache).
 *
 * All external dependencies (token, model, store, readline, output) are
 * injected so the whole flow is testable without auth glue.
 */
import type * as readline from "node:readline";
import type { ModelConfig } from "../agents/model-config.js";
import type { IdentityConfig } from "../config/types.agent.js";
import type { TriageConfig } from "../config/types.triage.js";
import { describeAction } from "./rule-types.js";
import type { LoadedRules } from "./rules-file.js";
import { evaluableRules, saveRules } from "./rules-file.js";
import { ExternalEditError } from "./rules-file.js";
import type { TriageStore } from "./store.js";
import { classifyMessages, fetchMessagesToTriage } from "./classify.js";
import type { Proposal } from "./classify.js";
import { FolderResolver } from "./executor.js";
import { reviewProposals } from "./review.js";
import { applyOneStrikeDemotions } from "./lifecycle.js";
import { proposeMicroEdit, reviewMicroEdit } from "./refine.js";

export type ResolvedTriageConfig = Required<
  Omit<TriageConfig, "rulesPath" | "defaultForwardTarget">
> &
  Pick<TriageConfig, "rulesPath" | "defaultForwardTarget">;

export type TriageRunOptions = {
  limit?: number;
  folder?: string;
  all?: boolean;
  dryRun?: boolean;
};

export type TriageRunSummary = {
  fetched: number;
  classified: number;
  approved: number;
  rejected: number;
  corrected: number;
  skipped: number;
  auto: number;
  failed: number;
  undistilled: number;
};

function proposalLine(p: Proposal): string {
  return (
    `  ${p.envelope.fromName || p.envelope.from} — "${p.envelope.subject || "(no subject)"}"` +
    ` → ${describeAction(p.proposedAction)} (${p.ruleId ?? "no rule"}, ${p.confidence})`
  );
}

export async function runTriage(params: {
  token: string;
  modelConfig: ModelConfig;
  identity: IdentityConfig;
  triage: ResolvedTriageConfig;
  loaded: LoadedRules;
  store: TriageStore;
  rl: readline.Interface;
  out: (line: string) => void;
  options: TriageRunOptions;
}): Promise<TriageRunSummary> {
  const { store, out, options, triage } = params;
  let loaded = params.loaded;

  // --- Phase 1: fetch ---
  const limit = options.limit ?? triage.defaultLimit;
  const envelopes = await fetchMessagesToTriage({
    token: params.token,
    store,
    limit,
    snippetChars: triage.snippetChars,
    folder: options.folder,
    includeRead: options.all,
  });

  const summary: TriageRunSummary = {
    fetched: envelopes.length,
    classified: 0,
    approved: 0,
    rejected: 0,
    corrected: 0,
    skipped: 0,
    auto: 0,
    failed: 0,
    undistilled: 0,
  };

  if (envelopes.length === 0) {
    out("Nothing to triage — no new messages.");
    summary.undistilled = store.countUndistilledSignals();
    return summary;
  }

  const rules = evaluableRules(loaded.file);
  if (rules.length === 0) {
    out(
      "No active rules yet — running in observation mode. Corrections you " +
        "make during review become the seeds for your first rules.",
    );
  }
  out(
    `Classifying ${envelopes.length} message(s) against ${rules.length} rule(s)...`,
  );

  // --- Phase 2: classify (structurally read-only agent) ---
  const runId = store.createRun("manual");
  const { proposals, unclassified } = await classifyMessages({
    envelopes,
    rules,
    modelConfig: params.modelConfig,
    toolContext: { token: params.token },
    store,
    runId,
    identity: params.identity,
    chunkSize: triage.chunkSize,
    maxRules: triage.maxRules,
    onProgress: (done, total) => out(`  ...classified ${done}/${total}`),
  });
  summary.classified = proposals.length;

  if (unclassified.length > 0) {
    out(`⚠️  ${unclassified.length} message(s) were not classified:`);
    for (const e of unclassified) {
      out(`  ${e.from} — "${e.subject}"`);
    }
  }

  // --- Dry run: show, persist as skipped, stop before any action ---
  if (options.dryRun) {
    out("");
    out(`Dry run — ${proposals.length} proposal(s), nothing executed:`);
    for (const p of proposals) out(proposalLine(p));
    for (const p of proposals) store.setVerdict(p.decisionId, "skipped");
    store.finishRun(runId, envelopes.length);
    summary.skipped = proposals.length;
    summary.undistilled = store.countUndistilledSignals();
    return summary;
  }

  // --- Phase 3: review + execute ---
  const folders = new FolderResolver(params.token, { createMissing: true });
  const { outcomes, folderIdUpdates } = await reviewProposals(proposals, {
    rl: params.rl,
    store,
    token: params.token,
    folders,
    rules,
    autoAct: triage.autoAct,
    defaultForwardTarget: triage.defaultForwardTarget,
    out,
  });

  for (const o of outcomes) {
    summary[o.verdict === "pending" ? "skipped" : o.verdict]++;
    if (o.execution && !o.execution.ok) summary.failed++;
  }

  // --- Post-review learning ---
  let rulesDirty = false;

  // Folder-id cache: machine bookkeeping, no revision bump
  for (const [ruleId, folderId] of folderIdUpdates) {
    const rule = loaded.file.rules.find((r) => r.id === ruleId);
    if (rule && rule.action.type === "move" && rule.action.folderId !== folderId) {
      rule.action.folderId = folderId;
      rulesDirty = true;
    }
  }

  // One-strike demotion for trusted rules
  const demoted = applyOneStrikeDemotions(outcomes, loaded.file, store);
  for (const rule of demoted) {
    out(
      `⬇️  Rule "${rule.id}" demoted from trusted to active (a correction/rejection is one strike).`,
    );
    rulesDirty = true;
  }

  // Immediate micro-learning: one minimal edit per rule-contradicting correction
  for (const o of outcomes) {
    if (o.verdict !== "corrected" || !o.proposal.ruleId) continue;
    const rule = loaded.file.rules.find((r) => r.id === o.proposal.ruleId);
    if (!rule) continue;
    const decision = store.getDecision(o.proposal.decisionId);
    if (!decision) continue;

    let newMatch: string | null = null;
    try {
      newMatch = await proposeMicroEdit({
        rule,
        decision,
        modelConfig: params.modelConfig,
        identity: params.identity,
      });
    } catch {
      // Micro-learning is best-effort — a model hiccup never fails the run
    }
    if (!newMatch) continue;

    const applied = await reviewMicroEdit({
      rl: params.rl,
      rule,
      newMatch,
      decisionId: o.proposal.decisionId,
      file: loaded.file,
      store,
      out,
    });
    if (applied) {
      store.markDistilled([o.proposal.decisionId]);
      rulesDirty = true;
    }
  }

  if (rulesDirty) {
    try {
      loaded = await saveRules(loaded, loaded.file);
    } catch (err) {
      if (err instanceof ExternalEditError) {
        out(`⚠️  ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  store.finishRun(runId, envelopes.length);

  // --- Summary + refine nudge ---
  out("");
  out(
    `Done: ${summary.approved} approved, ${summary.corrected} corrected, ` +
      `${summary.rejected} rejected, ${summary.skipped} skipped` +
      (summary.auto > 0 ? `, ${summary.auto} auto` : "") +
      (summary.failed > 0 ? ` — ${summary.failed} action(s) FAILED` : "") +
      ".",
  );
  summary.undistilled = store.countUndistilledSignals();
  if (summary.undistilled >= triage.improveAfterCorrections) {
    out(
      `💡 ${summary.undistilled} correction signal(s) waiting — run "openclippy triage refine" to improve your rules.`,
    );
  }
  return summary;
}
