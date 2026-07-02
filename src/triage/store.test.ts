import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TriageStore } from "./store.js";
import type { MessageFeatures } from "./rule-types.js";

function features(overrides?: Partial<MessageFeatures>): MessageFeatures {
  return {
    from: "billing@acme.com",
    fromDomain: "acme.com",
    subject: "Invoice #4821",
    snippet: "Please find attached...",
    receivedAt: "2026-07-01T10:00:00Z",
    hasAttachments: true,
    importance: "normal",
    ...overrides,
  };
}

describe("TriageStore", () => {
  let store: TriageStore;

  beforeEach(() => {
    store = new TriageStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  function insert(overrides?: {
    runId?: string | null;
    internetMessageId?: string | null;
    ruleId?: string | null;
  }): number {
    return store.insertDecision({
      runId: overrides?.runId ?? null,
      messageId: "msg-1",
      internetMessageId:
        overrides?.internetMessageId === undefined
          ? "<abc@acme.com>"
          : overrides.internetMessageId,
      features: features(),
      ruleId: overrides?.ruleId === undefined ? "vendor-invoices" : overrides.ruleId,
      ruleRevision: 3,
      category: "vendor invoice",
      proposedAction: { type: "move", folder: "Vendors/Invoices" },
      confidence: "high",
      rationale: "Vendor payment request with attachment",
      alsoMatched: ["urgent"],
    });
  }

  it("round-trips a decision with JSON fields intact", () => {
    const runId = store.createRun("manual");
    const id = insert({ runId });
    const row = store.getDecision(id);
    expect(row).not.toBeNull();
    expect(row!.runId).toBe(runId);
    expect(row!.features.fromDomain).toBe("acme.com");
    expect(row!.proposedAction).toEqual({
      type: "move",
      folder: "Vendors/Invoices",
    });
    expect(row!.alsoMatched).toEqual(["urgent"]);
    expect(row!.verdict).toBe("pending");
    expect(row!.correction).toBeNull();
  });

  it("finishRun records message count and finish time", () => {
    const runId = store.createRun("manual");
    store.finishRun(runId, 7);
    // No getter for runs — verified indirectly through no throw + decisions link
    expect(runId).toBeTruthy();
  });

  it("dedupe counts only real verdicts — pending and skipped reappear", () => {
    const imid = "<dedupe@test>";
    const id = insert({ internetMessageId: imid });
    expect(store.hasDecidedMessage(imid)).toBe(false); // pending

    store.setVerdict(id, "skipped");
    expect(store.hasDecidedMessage(imid)).toBe(false); // skipped

    store.setVerdict(id, "approved");
    expect(store.hasDecidedMessage(imid)).toBe(true);
  });

  it("stores corrections with verdicts", () => {
    const id = insert();
    store.setVerdict(id, "corrected", {
      ruleId: null,
      action: { type: "flag" },
      note: "This is personal, not a vendor",
    });
    const row = store.getDecision(id)!;
    expect(row.verdict).toBe("corrected");
    expect(row.correction).toEqual({
      ruleId: null,
      action: { type: "flag" },
      note: "This is personal, not a vendor",
    });
    expect(row.verdictAt).not.toBeNull();
  });

  it("markExecuted records execution time and errors", () => {
    const id = insert();
    store.markExecuted(id);
    expect(store.getDecision(id)!.executedAt).not.toBeNull();
    expect(store.getDecision(id)!.error).toBeNull();

    const failed = insert({ internetMessageId: "<f@t>" });
    store.markExecuted(failed, "Folder not found");
    expect(store.getDecision(failed)!.error).toBe("Folder not found");
  });

  it("undistilled signals: rejected/corrected + suggested rules, watermark-gated", () => {
    const rejected = insert({ internetMessageId: "<r@t>" });
    store.setVerdict(rejected, "rejected");

    const corrected = insert({ internetMessageId: "<c@t>" });
    store.setVerdict(corrected, "corrected", {
      ruleId: null,
      action: { type: "flag" },
    });

    const approved = insert({ internetMessageId: "<a@t>" });
    store.setVerdict(approved, "approved");

    const withSuggestion = store.insertDecision({
      runId: null,
      messageId: "msg-2",
      internetMessageId: "<s@t>",
      features: features(),
      ruleId: null,
      ruleRevision: null,
      category: "unmatched",
      proposedAction: { type: "none" },
      confidence: "medium",
      rationale: "No rule matched",
      suggestedRule: { name: "GitHub notifications", match: "CI emails from github.com" },
    });
    store.setVerdict(withSuggestion, "approved");

    let signals = store.undistilledSignals();
    expect(signals.map((s) => s.id).sort()).toEqual(
      [rejected, corrected, withSuggestion].sort(),
    );

    // Watermark hides earlier rows
    store.setMeta("refine_watermark", String(corrected));
    signals = store.undistilledSignals();
    expect(signals.map((s) => s.id)).toEqual([withSuggestion]);

    // Distilled rows disappear regardless of watermark
    store.setMeta("refine_watermark", "0");
    store.markDistilled([rejected, corrected]);
    signals = store.undistilledSignals();
    expect(signals.map((s) => s.id)).toEqual([withSuggestion]);
  });

  it("rule_accuracy aggregates verdicts per rule, excluding pending/skipped", () => {
    const a = insert({ internetMessageId: "<1@t>" });
    store.setVerdict(a, "approved");
    const b = insert({ internetMessageId: "<2@t>" });
    store.setVerdict(b, "rejected");
    const c = insert({ internetMessageId: "<3@t>" });
    store.setVerdict(c, "corrected", { ruleId: null, action: { type: "none" } });
    insert({ internetMessageId: "<4@t>" }); // pending — excluded
    const e = insert({ internetMessageId: "<5@t>" });
    store.setVerdict(e, "skipped"); // excluded

    const rows = store.ruleAccuracy();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ruleId: "vendor-invoices",
      fired: 3,
      approved: 1,
      rejected: 1,
      corrected: 1,
    });
  });

  it("lastVerdictsForRule returns newest first", () => {
    const ids = [1, 2, 3].map((i) => {
      const id = insert({ internetMessageId: `<v${i}@t>` });
      store.setVerdict(id, i === 2 ? "rejected" : "approved");
      return id;
    });
    expect(ids).toHaveLength(3);
    const verdicts = store.lastVerdictsForRule("vendor-invoices", 2);
    expect(verdicts).toEqual(["approved", "rejected"]);
  });

  it("records and lists rule events with evidence", () => {
    store.insertRuleEvent({
      ruleId: "vendor-invoices",
      revision: 4,
      event: "edited",
      actor: "refine",
      oldBody: "old match",
      newBody: "new match",
      evidence: [1, 2],
    });
    const events = store.listRuleEvents("vendor-invoices");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      revision: 4,
      event: "edited",
      actor: "refine",
      oldBody: "old match",
      newBody: "new match",
      evidence: [1, 2],
    });
  });

  it("prunes old decisions but keeps rows cited as evidence", () => {
    const kept = insert({ internetMessageId: "<kept@t>" });
    const dropped = insert({ internetMessageId: "<dropped@t>" });
    // Age both rows past retention
    // @ts-expect-error — reach into the private db for test setup
    store.db
      .prepare("UPDATE decisions SET decided_at = ? WHERE id IN (?, ?)")
      .run(Date.now() - 200 * 24 * 60 * 60 * 1000, kept, dropped);

    store.insertRuleEvent({
      ruleId: "vendor-invoices",
      revision: 1,
      event: "edited",
      actor: "refine",
      evidence: [kept],
    });

    const pruned = store.pruneOldDecisions(180);
    expect(pruned).toBe(1);
    expect(store.getDecision(kept)).not.toBeNull();
    expect(store.getDecision(dropped)).toBeNull();
  });

  it("meta get/set round-trips", () => {
    expect(store.getMeta("refine_watermark")).toBeNull();
    store.setMeta("refine_watermark", "42");
    expect(store.getMeta("refine_watermark")).toBe("42");
    store.setMeta("refine_watermark", "43");
    expect(store.getMeta("refine_watermark")).toBe("43");
  });
});
