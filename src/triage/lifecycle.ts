/**
 * Rule lifecycle: proposed → active → trusted → retired.
 *
 * Promotions and retirements are only ever *proposed* to the user (the
 * caller presents them); demotion is the one automatic transition —
 * one strike (any rejection or correction) knocks a trusted rule back
 * to active.
 */
import type { RulesFile, RuleState, TriageRule } from "./rule-types.js";
import type { TriageStore } from "./store.js";
import type { ReviewOutcome } from "./review.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Promotion criteria (all must hold, checked against the decision log). */
const PROMOTION_MIN_FIRED = 10;
const PROMOTION_LAST_N = 10;
const PROMOTION_APPROVAL_RATE = 0.95;
const PROMOTION_STABLE_DAYS = 7;

/** Retirement criteria (either triggers a proposal). */
const RETIREMENT_IDLE_DAYS = 60;
const RETIREMENT_MIN_FIRED = 10;
const RETIREMENT_ACCURACY_FLOOR = 0.5;

export type LifecycleProposal = {
  ruleId: string;
  from: RuleState;
  to: RuleState;
  reason: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One-strike demotion: any rejected/corrected outcome on a trusted rule
 * demotes it to active immediately. Mutates the file in place and logs
 * rule_events; returns the demoted rules so the caller can report and save.
 */
export function applyOneStrikeDemotions(
  outcomes: ReviewOutcome[],
  file: RulesFile,
  store: TriageStore,
): TriageRule[] {
  const struck = new Set<string>();
  for (const o of outcomes) {
    if (
      (o.verdict === "rejected" || o.verdict === "corrected") &&
      o.proposal.ruleId
    ) {
      struck.add(o.proposal.ruleId);
    }
  }

  const demoted: TriageRule[] = [];
  for (const rule of file.rules) {
    if (rule.state === "trusted" && struck.has(rule.id)) {
      rule.state = "active";
      rule.updatedAt = todayIso();
      store.insertRuleEvent({
        ruleId: rule.id,
        revision: rule.revision,
        event: "demoted",
        actor: "user",
        evidence: outcomes
          .filter(
            (o) =>
              o.proposal.ruleId === rule.id &&
              (o.verdict === "rejected" || o.verdict === "corrected"),
          )
          .map((o) => o.proposal.decisionId),
      });
      demoted.push(rule);
    }
  }
  return demoted;
}

function ruleStableSince(rule: TriageRule, now: number): boolean {
  const stamp = rule.updatedAt ?? rule.createdAt;
  if (!stamp) return true; // no edit history — treat as stable
  const t = Date.parse(stamp);
  if (isNaN(t)) return true;
  return now - t >= PROMOTION_STABLE_DAYS * DAY_MS;
}

/** Active rules that have earned a promotion proposal. */
export function checkPromotions(
  store: TriageStore,
  file: RulesFile,
  now: number = Date.now(),
): LifecycleProposal[] {
  const accuracy = new Map(store.ruleAccuracy().map((r) => [r.ruleId, r]));
  const proposals: LifecycleProposal[] = [];

  for (const rule of file.rules) {
    if (rule.state !== "active") continue;
    const acc = accuracy.get(rule.id);
    if (!acc || acc.fired < PROMOTION_MIN_FIRED) continue;
    if (acc.corrected > 0) continue;
    if (!ruleStableSince(rule, now)) continue;

    const lastN = store.lastVerdictsForRule(rule.id, PROMOTION_LAST_N);
    if (lastN.length < PROMOTION_LAST_N) continue;
    const approvedRate =
      lastN.filter((v) => v === "approved" || v === "auto").length / lastN.length;
    if (approvedRate < PROMOTION_APPROVAL_RATE) continue;

    proposals.push({
      ruleId: rule.id,
      from: "active",
      to: "trusted",
      reason: `fired ${acc.fired}×, last ${lastN.length} all approved, 0 corrections, stable ≥ ${PROMOTION_STABLE_DAYS} days`,
    });
  }
  return proposals;
}

/** Rules that have earned a retirement proposal. */
export function checkRetirements(
  store: TriageStore,
  file: RulesFile,
  now: number = Date.now(),
): LifecycleProposal[] {
  const accuracy = new Map(store.ruleAccuracy().map((r) => [r.ruleId, r]));
  const proposals: LifecycleProposal[] = [];
  const idleCutoff = now - RETIREMENT_IDLE_DAYS * DAY_MS;

  for (const rule of file.rules) {
    if (rule.state !== "active" && rule.state !== "trusted") continue;
    const acc = accuracy.get(rule.id);

    const created = rule.createdAt ? Date.parse(rule.createdAt) : NaN;
    const oldEnough = !isNaN(created) && created < idleCutoff;
    const lastFired = acc?.lastDecidedAt ?? null;
    if (oldEnough && (lastFired === null || lastFired < idleCutoff)) {
      proposals.push({
        ruleId: rule.id,
        from: rule.state,
        to: "retired",
        reason: `no firings in the last ${RETIREMENT_IDLE_DAYS} days`,
      });
      continue;
    }

    if (acc && acc.fired >= RETIREMENT_MIN_FIRED) {
      const rate = (acc.approved + acc.auto) / acc.fired;
      if (rate < RETIREMENT_ACCURACY_FLOOR) {
        proposals.push({
          ruleId: rule.id,
          from: rule.state,
          to: "retired",
          reason: `accuracy ${(rate * 100).toFixed(0)}% over ${acc.fired} firings (< ${RETIREMENT_ACCURACY_FLOOR * 100}%)`,
        });
      }
    }
  }
  return proposals;
}

/**
 * Apply a user-approved lifecycle change. Mutates the file in place and
 * logs the rule_events row; the caller saves the file.
 */
export function applyLifecycleChange(
  proposal: LifecycleProposal,
  file: RulesFile,
  store: TriageStore,
  actor: "user" | "refine" = "user",
): boolean {
  const rule = file.rules.find((r) => r.id === proposal.ruleId);
  if (!rule || rule.state !== proposal.from) return false;

  rule.state = proposal.to;
  rule.updatedAt = todayIso();
  store.insertRuleEvent({
    ruleId: rule.id,
    revision: rule.revision,
    event: proposal.to === "trusted" ? "promoted" : proposal.to === "retired" ? "retired" : "demoted",
    actor,
    evidence: { reason: proposal.reason },
  });
  return true;
}
