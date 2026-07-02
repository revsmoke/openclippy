import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  applyOneStrikeDemotions,
  applyLifecycleChange,
  checkPromotions,
  checkRetirements,
} from "./lifecycle.js";
import { TriageStore } from "./store.js";
import type { RulesFile, TriageRule, Verdict } from "./rule-types.js";
import type { ReviewOutcome } from "./review.js";
import type { Proposal } from "./classify.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-01T00:00:00Z");

function rule(overrides?: Partial<TriageRule>): TriageRule {
  return {
    id: "vendor-invoices",
    name: "Vendor invoices",
    state: "active",
    priority: 20,
    match: "Vendor invoices.",
    examples: [],
    action: { type: "flag" },
    revision: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-06-01", // stable > 7 days before NOW
    ...overrides,
  };
}

function file(...rules: TriageRule[]): RulesFile {
  return { version: 1, rules };
}

function outcome(ruleId: string | null, verdict: Verdict): ReviewOutcome {
  return {
    proposal: { decisionId: 1, ruleId } as Proposal,
    verdict,
  };
}

describe("lifecycle", () => {
  let store: TriageStore;

  beforeEach(() => {
    store = new TriageStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  /** Seed N decided firings for a rule, newest last. */
  function seedVerdicts(ruleId: string, verdicts: Verdict[], decidedAt = NOW - DAY) {
    for (const v of verdicts) {
      const id = store.insertDecision({
        runId: null,
        messageId: "m",
        internetMessageId: null,
        features: {
          from: "x@t.com",
          fromDomain: "t.com",
          subject: "s",
          snippet: "",
          receivedAt: "",
          hasAttachments: false,
          importance: "normal",
        },
        ruleId,
        ruleRevision: 1,
        category: "c",
        proposedAction: { type: "flag" },
        confidence: "high",
        rationale: "r",
      });
      store.setVerdict(id, v, v === "corrected" ? { ruleId: null, action: { type: "none" } } : undefined);
      // Pin decided_at so retirement checks are deterministic
      // @ts-expect-error — reach into the private db for test setup
      store.db.prepare("UPDATE decisions SET decided_at = ? WHERE id = ?").run(decidedAt, id);
    }
  }

  describe("one-strike demotion", () => {
    it("demotes a trusted rule on any rejection or correction", () => {
      const trusted = rule({ state: "trusted" });
      const f = file(trusted);
      const demoted = applyOneStrikeDemotions(
        [outcome("vendor-invoices", "rejected")],
        f,
        store,
      );
      expect(demoted.map((r) => r.id)).toEqual(["vendor-invoices"]);
      expect(f.rules[0].state).toBe("active");
      expect(store.listRuleEvents("vendor-invoices")[0].event).toBe("demoted");
    });

    it("does not touch active rules or approved outcomes", () => {
      const f = file(rule({ state: "active" }), rule({ id: "other", state: "trusted" }));
      const demoted = applyOneStrikeDemotions(
        [outcome("vendor-invoices", "corrected"), outcome("other", "approved")],
        f,
        store,
      );
      expect(demoted).toEqual([]);
      expect(f.rules[1].state).toBe("trusted");
    });
  });

  describe("checkPromotions", () => {
    it("proposes promotion when all criteria hold", () => {
      seedVerdicts("vendor-invoices", Array(10).fill("approved") as Verdict[]);
      const proposals = checkPromotions(store, file(rule()), NOW);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]).toMatchObject({
        ruleId: "vendor-invoices",
        from: "active",
        to: "trusted",
      });
    });

    it("requires 10 firings", () => {
      seedVerdicts("vendor-invoices", Array(9).fill("approved") as Verdict[]);
      expect(checkPromotions(store, file(rule()), NOW)).toEqual([]);
    });

    it("blocks on any correction ever", () => {
      seedVerdicts("vendor-invoices", [
        "corrected",
        ...(Array(10).fill("approved") as Verdict[]),
      ]);
      expect(checkPromotions(store, file(rule()), NOW)).toEqual([]);
    });

    it("blocks on a rejection in the last 10", () => {
      seedVerdicts("vendor-invoices", [
        ...(Array(9).fill("approved") as Verdict[]),
        "rejected",
      ]);
      expect(checkPromotions(store, file(rule()), NOW)).toEqual([]);
    });

    it("blocks when the rule was edited within 7 days", () => {
      seedVerdicts("vendor-invoices", Array(10).fill("approved") as Verdict[]);
      const recent = rule({ updatedAt: "2026-06-29" }); // 2 days before NOW
      expect(checkPromotions(store, file(recent), NOW)).toEqual([]);
    });

    it("only considers active rules", () => {
      seedVerdicts("vendor-invoices", Array(10).fill("approved") as Verdict[]);
      expect(
        checkPromotions(store, file(rule({ state: "trusted" })), NOW),
      ).toEqual([]);
    });
  });

  describe("checkRetirements", () => {
    it("proposes retirement for rules idle 60+ days", () => {
      // Old rule, no decisions at all
      const idle = rule({ createdAt: "2026-01-01" });
      const proposals = checkRetirements(store, file(idle), NOW);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].to).toBe("retired");
      expect(proposals[0].reason).toContain("60 days");
    });

    it("does not retire young rules that haven't fired yet", () => {
      const young = rule({ createdAt: "2026-06-20" });
      expect(checkRetirements(store, file(young), NOW)).toEqual([]);
    });

    it("proposes retirement below the accuracy floor", () => {
      seedVerdicts("vendor-invoices", [
        ...(Array(4).fill("approved") as Verdict[]),
        ...(Array(6).fill("rejected") as Verdict[]),
      ]);
      const proposals = checkRetirements(store, file(rule()), NOW);
      expect(proposals).toHaveLength(1);
      expect(proposals[0].reason).toContain("accuracy 40%");
    });

    it("keeps accurate, recently-fired rules", () => {
      seedVerdicts("vendor-invoices", Array(10).fill("approved") as Verdict[]);
      expect(checkRetirements(store, file(rule()), NOW)).toEqual([]);
    });
  });

  describe("applyLifecycleChange", () => {
    it("applies a promotion and logs the event", () => {
      const f = file(rule());
      const ok = applyLifecycleChange(
        { ruleId: "vendor-invoices", from: "active", to: "trusted", reason: "earned" },
        f,
        store,
      );
      expect(ok).toBe(true);
      expect(f.rules[0].state).toBe("trusted");
      expect(store.listRuleEvents("vendor-invoices")[0].event).toBe("promoted");
    });

    it("refuses when the current state no longer matches", () => {
      const f = file(rule({ state: "retired" }));
      const ok = applyLifecycleChange(
        { ruleId: "vendor-invoices", from: "active", to: "trusted", reason: "stale" },
        f,
        store,
      );
      expect(ok).toBe(false);
      expect(f.rules[0].state).toBe("retired");
    });
  });
});
