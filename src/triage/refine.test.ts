import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { proposeMicroEdit, reviewMicroEdit, runRefine, renderMatchDiff } from "./refine.js";
import { loadRules } from "./rules-file.js";
import { TriageStore } from "./store.js";
import { createMockRl } from "../test-utils/mock-rl.js";
import type { ModelConfig } from "../agents/model-config.js";
import type { TriageRule } from "./rule-types.js";

const MODEL_CONFIG: ModelConfig = {
  provider: "anthropic",
  model: "claude-test",
  apiKey: "sk-test",
  maxTokens: 4096,
};

const RULES_YAML = `
version: 1
rules:
  - id: vendor-invoices
    name: Vendor invoices
    state: active
    priority: 20
    match: Emails from vendors containing an invoice or payment request.
    action: { type: move, folder: "Vendors/Invoices" }
    revision: 2
`;

function textResponse(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

function toolUse(name: string, input: unknown) {
  return {
    content: [{ type: "tool_use", id: "t1", name, input }],
    stop_reason: "tool_use",
  };
}

describe("refine", () => {
  let dir: string;
  let path: string;
  let store: TriageStore;

  beforeEach(async () => {
    mockCreate.mockReset();
    dir = await mkdtemp(join(tmpdir(), "triage-refine-"));
    path = join(dir, "rules.yaml");
    await writeFile(path, RULES_YAML, "utf-8");
    store = new TriageStore(":memory:");
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  function seedCorrection(note?: string): number {
    const id = store.insertDecision({
      runId: null,
      messageId: "m1",
      internetMessageId: "<m1@t>",
      features: {
        from: "noreply@amazon.com",
        fromDomain: "amazon.com",
        subject: "Your order receipt",
        snippet: "Thanks for your purchase",
        receivedAt: "2026-06-30T09:00:00Z",
        hasAttachments: false,
        importance: "normal",
      },
      ruleId: "vendor-invoices",
      ruleRevision: 2,
      category: "vendor invoice",
      proposedAction: { type: "move", folder: "Vendors/Invoices" },
      confidence: "high",
      rationale: "Looks like an invoice",
    });
    store.setVerdict(id, "corrected", {
      ruleId: null,
      action: { type: "none" },
      ...(note ? { note } : {}),
    });
    return id;
  }

  describe("renderMatchDiff", () => {
    it("renders old lines as - and new lines as +", () => {
      const diff = renderMatchDiff("old text", "new text");
      expect(diff).toContain("- old text");
      expect(diff).toContain("+ new text");
    });
  });

  describe("proposeMicroEdit", () => {
    it("returns the agent's minimal edit", async () => {
      const decisionId = seedCorrection("Personal receipts aren't invoices");
      mockCreate
        .mockResolvedValueOnce(
          toolUse("triage_rule_edit", {
            newMatch:
              "Emails from vendors containing an invoice or payment request. NOT personal purchase receipts.",
          }),
        )
        .mockResolvedValueOnce(textResponse("Done."));

      const loaded = await loadRules(path);
      const newMatch = await proposeMicroEdit({
        rule: loaded.file.rules[0],
        decision: store.getDecision(decisionId)!,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
      });

      expect(newMatch).toContain("NOT personal purchase receipts");
      // The correction context reached the agent
      const message = mockCreate.mock.calls[0][0].messages[0].content;
      expect(message).toContain("noreply@amazon.com");
      expect(message).toContain("Personal receipts aren't invoices");
    });

    it("returns null when the agent declines to call the tool", async () => {
      const decisionId = seedCorrection();
      mockCreate.mockResolvedValueOnce(textResponse("No small edit would help."));
      const loaded = await loadRules(path);
      const newMatch = await proposeMicroEdit({
        rule: loaded.file.rules[0],
        decision: store.getDecision(decisionId)!,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
      });
      expect(newMatch).toBeNull();
    });
  });

  describe("reviewMicroEdit", () => {
    it("applies an accepted edit: revision bump + edited rule_event with evidence", async () => {
      const loaded = await loadRules(path);
      const rule = loaded.file.rules[0];
      const rl = createMockRl("y");

      const applied = await reviewMicroEdit({
        rl,
        rule,
        newMatch: "Updated match text.",
        decisionId: 41,
        file: loaded.file,
        store,
        out: () => {},
      });

      expect(applied).toBe(true);
      expect(rule.match).toBe("Updated match text.");
      expect(rule.revision).toBe(3);
      const events = store.listRuleEvents("vendor-invoices");
      expect(events[0]).toMatchObject({
        event: "edited",
        actor: "agent",
        newBody: "Updated match text.",
        evidence: [41],
      });
    });

    it("declining leaves the rule untouched", async () => {
      const loaded = await loadRules(path);
      const rule = loaded.file.rules[0];
      const before = rule.match;
      const rl = createMockRl("n");

      const applied = await reviewMicroEdit({
        rl,
        rule,
        newMatch: "Updated match text.",
        decisionId: 41,
        file: loaded.file,
        store,
        out: () => {},
      });

      expect(applied).toBe(false);
      expect(rule.match).toBe(before);
      expect(rule.revision).toBe(2);
      expect(store.listRuleEvents("vendor-invoices")).toEqual([]);
    });
  });

  describe("runRefine", () => {
    it("applies an approved edit: .bak + rule_events + watermark + distilled", async () => {
      const signalId = seedCorrection("Not receipts");
      mockCreate
        .mockResolvedValueOnce(
          toolUse("triage_rules_propose", {
            proposals: [
              {
                kind: "edit",
                ruleId: "vendor-invoices",
                newMatch: "Vendor invoices. NOT personal purchase receipts.",
                evidence: [signalId],
                rationale: "Excludes personal receipts",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(textResponse("Proposed."));

      const loaded = await loadRules(path);
      const rl = createMockRl("a"); // approve the edit
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
        rl,
        out: () => {},
      });

      expect(summary).toMatchObject({ signals: 1, proposals: 1, applied: 1 });

      // File rewritten atomically with a .bak of the previous content
      const saved = await readFile(path, "utf-8");
      expect(saved).toContain("NOT personal purchase receipts");
      expect(saved).toContain("revision: 3");
      expect(await readFile(`${path}.bak`, "utf-8")).toBe(RULES_YAML);

      // Audit trail + learning bookkeeping
      const events = store.listRuleEvents("vendor-invoices");
      expect(events[0]).toMatchObject({
        event: "edited",
        actor: "refine",
        evidence: [signalId],
      });
      expect(store.getMeta("refine_watermark")).toBe(String(signalId));
      expect(store.undistilledSignals()).toEqual([]);
    });

    it("creates an approved new rule born active with created event", async () => {
      const s1 = seedCorrection();
      mockCreate
        .mockResolvedValueOnce(
          toolUse("triage_rules_propose", {
            proposals: [
              {
                kind: "new",
                rule: {
                  id: "amazon-receipts",
                  name: "Amazon receipts",
                  match: "Order receipts and shipping notifications from Amazon.",
                  action: { type: "move", folder: "Receipts" },
                },
                evidence: [s1],
                rationale: "Repeated corrections on amazon.com mail",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(textResponse("Proposed."));

      const loaded = await loadRules(path);
      const rl = createMockRl("y"); // confirm creation
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
        rl,
        out: () => {},
      });

      expect(summary.applied).toBe(1);
      const reloaded = await loadRules(path);
      const created = reloaded.file.rules.find((r) => r.id === "amazon-receipts");
      expect(created).toBeDefined();
      expect(created!.state).toBe("active");
      expect(store.listRuleEvents("amazon-receipts")[0].event).toBe("created");
    });

    it("rejected proposals leave the file untouched but still advance the watermark", async () => {
      const signalId = seedCorrection();
      mockCreate
        .mockResolvedValueOnce(
          toolUse("triage_rules_propose", {
            proposals: [
              {
                kind: "retire",
                ruleId: "vendor-invoices",
                evidence: [signalId],
                rationale: "Too noisy",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(textResponse("Proposed."));

      const before = await readFile(path, "utf-8");
      const loaded = await loadRules(path);
      const rl = createMockRl("n"); // reject retirement
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
        rl,
        out: () => {},
      });

      expect(summary.applied).toBe(0);
      expect(await readFile(path, "utf-8")).toBe(before);
      expect(store.getMeta("refine_watermark")).toBe(String(signalId));
      expect(store.undistilledSignals()).toEqual([]);
    });

    it("feeds invalid proposals back as isError so the agent retries", async () => {
      seedCorrection();
      mockCreate
        .mockResolvedValueOnce(
          toolUse("triage_rules_propose", {
            proposals: [{ kind: "edit" }], // missing everything
          }),
        )
        .mockResolvedValueOnce(textResponse("Could not fix."));

      const loaded = await loadRules(path);
      const rl = createMockRl();
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
        rl,
        out: () => {},
      });

      expect(summary.proposals).toBe(0);
      // The validation error went back to the model as a tool_result error
      const secondCall = mockCreate.mock.calls[1][0];
      const toolResult = secondCall.messages.at(-1).content[0];
      expect(toolResult.type).toBe("tool_result");
      expect(toolResult.is_error).toBe(true);
    });

    it("skips proposals citing evidence outside the logged signals", async () => {
      seedCorrection();
      mockCreate
        .mockResolvedValueOnce(
          toolUse("triage_rules_propose", {
            proposals: [
              {
                kind: "edit",
                ruleId: "vendor-invoices",
                newMatch: "Sneaky drift.",
                evidence: [99999], // not a real signal
                rationale: "Unfounded",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(textResponse("Proposed."));

      const before = await readFile(path, "utf-8");
      const loaded = await loadRules(path);
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
        rl: createMockRl(),
        out: () => {},
      });

      expect(summary.applied).toBe(0);
      expect(await readFile(path, "utf-8")).toBe(before);
    });

    it("proposes promotions from the accuracy log and applies on confirm", async () => {
      // 10 clean approvals on a stable rule → promotion proposal
      const stableYaml = RULES_YAML.replace(
        "revision: 2",
        "revision: 2\n    createdAt: 2026-01-01\n    updatedAt: 2026-01-01",
      );
      await writeFile(path, stableYaml, "utf-8");
      for (let i = 0; i < 10; i++) {
        const id = store.insertDecision({
          runId: null,
          messageId: `m${i}`,
          internetMessageId: `<p${i}@t>`,
          features: {
            from: "x@t.com",
            fromDomain: "t.com",
            subject: "s",
            snippet: "",
            receivedAt: "",
            hasAttachments: false,
            importance: "normal",
          },
          ruleId: "vendor-invoices",
          ruleRevision: 2,
          category: "c",
          proposedAction: { type: "flag" },
          confidence: "high",
          rationale: "r",
        });
        store.setVerdict(id, "approved");
        store.markDistilled([id]);
      }

      const loaded = await loadRules(path);
      const rl = createMockRl("y"); // accept promotion
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: MODEL_CONFIG,
        identity: { name: "Clippy" },
        rl,
        out: () => {},
      });

      expect(summary.lifecycleApplied).toBe(1);
      const reloaded = await loadRules(path);
      expect(reloaded.file.rules[0].state).toBe("trusted");
      expect(
        store.listRuleEvents("vendor-invoices").map((e) => e.event),
      ).toContain("promoted");
      // No signals → no agent call at all
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
