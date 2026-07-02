import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { triageFeedbackCreateTool, triageRulesListTool } from "./tools.js";
import { loadTriageIntegration } from "./integration.js";
import { TriageStore } from "./store.js";

const RULES_YAML = `
version: 1
rules:
  - id: vendor-invoices
    name: Vendor invoices
    state: active
    priority: 20
    match: Vendor invoices.
    action: { type: move, folder: "Vendors" }
  - id: dead-rule
    name: Dead
    state: retired
    priority: 90
    match: Old.
    action: { type: none }
`;

describe("triage conversational tools", () => {
  let dir: string;
  let rulesPath: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "triage-tools-"));
    rulesPath = join(dir, "rules.yaml");
    dbPath = join(dir, "triage.db");
    await writeFile(rulesPath, RULES_YAML, "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("triage_rules_list", () => {
    it("lists rules with accuracy stats", async () => {
      const store = new TriageStore(dbPath);
      const id = store.insertDecision({
        runId: null,
        messageId: "m1",
        internetMessageId: "<m1@t>",
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
        ruleRevision: 1,
        category: "c",
        proposedAction: { type: "flag" },
        confidence: "high",
        rationale: "r",
      });
      store.setVerdict(id, "approved");
      store.close();

      const tool = triageRulesListTool({ rulesPath, dbPath });
      const result = await tool.execute({}, { token: "" });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain("vendor-invoices");
      expect(result.content).toContain("fired 1×");
      expect(result.content).toContain("dead-rule");
    });

    it("reports a friendly message when triage was never set up", async () => {
      const tool = triageRulesListTool({
        rulesPath: join(dir, "missing.yaml"),
        dbPath,
      });
      const result = await tool.execute({}, { token: "" });
      expect(result.isError).toBeUndefined();
      expect(result.content).toContain("not set up yet");
    });
  });

  describe("triage_feedback_create", () => {
    it("logs a corrected decision that surfaces as a refine signal", async () => {
      const tool = triageFeedbackCreateTool({ dbPath });
      const result = await tool.execute(
        {
          from: "noreply@github.com",
          subject: "CI failed",
          note: "CI emails should be moved to the Builds folder",
          desiredAction: { type: "move", folder: "Builds" },
          ruleId: "vendor-invoices",
        },
        { token: "" },
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain("Feedback logged");

      const store = new TriageStore(dbPath);
      const signals = store.undistilledSignals();
      expect(signals).toHaveLength(1);
      expect(signals[0].verdict).toBe("corrected");
      expect(signals[0].ruleId).toBe("vendor-invoices");
      expect(signals[0].correction).toMatchObject({
        action: { type: "move", folder: "Builds" },
        note: "CI emails should be moved to the Builds folder",
      });
      store.close();
    });

    it("rejects missing notes and malformed actions", async () => {
      const tool = triageFeedbackCreateTool({ dbPath });
      expect((await tool.execute({}, { token: "" })).isError).toBe(true);
      expect(
        (
          await tool.execute(
            { note: "x", desiredAction: { type: "teleport" } },
            { token: "" },
          )
        ).isError,
      ).toBe(true);
    });
  });

  describe("loadTriageIntegration", () => {
    it("returns nothing when no rules file exists", async () => {
      const result = await loadTriageIntegration(
        { triage: { rulesPath: join(dir, "missing.yaml") } },
        "standard",
      );
      expect(result.tools).toEqual([]);
      expect(result.hints).toEqual([]);
    });

    it("summarizes active rules and exposes both tools under standard", async () => {
      const result = await loadTriageIntegration(
        { triage: { rulesPath } },
        "standard",
      );
      expect(result.hints[0]).toContain("vendor-invoices");
      expect(result.hints[0]).not.toContain("dead-rule"); // retired — not summarized
      expect(result.tools.map((t) => t.name)).toEqual([
        "triage_rules_list",
        "triage_feedback_create",
      ]);
    });

    it("read-only profile drops triage_feedback_create", async () => {
      const result = await loadTriageIntegration(
        { triage: { rulesPath } },
        "read-only",
      );
      expect(result.tools.map((t) => t.name)).toEqual(["triage_rules_list"]);
    });
  });
});
