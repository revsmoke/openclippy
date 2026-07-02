/**
 * Integration test: Triage Flow
 *
 * Drives the full `openclippy triage` run — fetch → classify → review →
 * execute → learn — with a real TriageStore (in-memory sqlite), a real
 * rules file on disk, and a real agent runtime; only the Graph API,
 * the Anthropic SDK, and the terminal are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/graph/client.js", () => ({
  graphRequest: vi.fn(),
  graphPaginate: vi.fn(),
  graphBatch: vi.fn(),
  GraphApiError: class GraphApiError extends Error {
    constructor(
      public readonly path: string,
      public readonly status: number,
      public readonly body: string,
    ) {
      super(`Graph API ${path} failed (${status})`);
      this.name = "GraphApiError";
    }
    get isThrottled() {
      return this.status === 429;
    }
  },
}));

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { graphRequest } from "../../src/graph/client.js";
import { runTriage } from "../../src/triage/run.js";
import { loadRules } from "../../src/triage/rules-file.js";
import { TriageStore } from "../../src/triage/store.js";
import { createMockRl } from "../../src/test-utils/mock-rl.js";
import type { ModelConfig } from "../../src/agents/model-config.js";
import type { ResolvedTriageConfig } from "../../src/triage/run.js";

const mockGraphRequest = vi.mocked(graphRequest);

const MODEL_CONFIG: ModelConfig = {
  provider: "anthropic",
  model: "claude-test",
  apiKey: "sk-test",
  maxTokens: 4096,
};

const TRIAGE_CONFIG: ResolvedTriageConfig = {
  defaultLimit: 25,
  chunkSize: 15,
  autoAct: false,
  improveAfterCorrections: 3,
  retentionDays: 180,
  maxRules: 50,
  snippetChars: 300,
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
  - id: group-support
    name: Support requests
    state: active
    priority: 30
    match: Customer support requests that belong to the shared support queue.
    action: { type: forward, to: "support@archinet.net" }
`;

function inboxMessage(id: string, imid: string, from: string, subject: string) {
  return {
    id,
    internetMessageId: imid,
    subject,
    bodyPreview: `Preview for ${subject}`,
    from: { emailAddress: { address: from, name: from.split("@")[0] } },
    receivedDateTime: "2026-07-01T10:00:00Z",
    hasAttachments: false,
    importance: "normal",
    isRead: false,
  };
}

describe("triage flow (integration)", () => {
  let dir: string;
  let rulesPath: string;
  let store: TriageStore;

  beforeEach(async () => {
    mockGraphRequest.mockReset();
    mockCreate.mockReset();
    dir = await mkdtemp(join(tmpdir(), "triage-flow-"));
    rulesPath = join(dir, "rules.yaml");
    await writeFile(rulesPath, RULES_YAML, "utf-8");
    store = new TriageStore(":memory:");
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("runs fetch → classify → review → execute → learn end to end", async () => {
    // A message decided in a prior run — must be deduped out of the fetch
    const priorId = store.insertDecision({
      runId: null,
      messageId: "m0",
      internetMessageId: "<m0@t>",
      features: {
        from: "old@t.com",
        fromDomain: "t.com",
        subject: "old",
        snippet: "",
        receivedAt: "",
        hasAttachments: false,
        importance: "normal",
      },
      ruleId: null,
      ruleRevision: null,
      category: "x",
      proposedAction: { type: "none" },
      confidence: "high",
      rationale: "r",
    });
    store.setVerdict(priorId, "approved");

    // --- Graph responses, in call order ---
    mockGraphRequest
      // 1. fetch inbox page
      .mockResolvedValueOnce({
        value: [
          inboxMessage("m0", "<m0@t>", "old@t.com", "Already triaged"),
          inboxMessage("m1", "<m1@t>", "billing@acme.com", "Invoice #4821"),
          inboxMessage("m2", "<m2@t>", "customer@example.com", "Need help with login"),
        ],
      })
      // 2-3. approve m1 → resolve "Vendors/Invoices" (top level, then child)
      .mockResolvedValueOnce({
        value: [{ id: "f-vendors", displayName: "Vendors" }],
      })
      .mockResolvedValueOnce({
        value: [{ id: "f-invoices", displayName: "Invoices" }],
      })
      // 4. the move itself
      .mockResolvedValueOnce({ id: "m1-moved" })
      // 5. corrected m2 → flag PATCH
      .mockResolvedValueOnce(undefined);

    // --- Classification agent: one record per email, then done ---
    mockCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "triage_record",
            input: {
              messageId: "m1",
              ruleId: "vendor-invoices",
              category: "vendor invoice",
              confidence: "high",
              proposedAction: { type: "move", folder: "Vendors/Invoices" },
              rationale: "Vendor payment request",
              alsoMatched: [],
            },
          },
          {
            type: "tool_use",
            id: "t2",
            name: "triage_record",
            input: {
              messageId: "m2",
              ruleId: "group-support",
              category: "support request",
              confidence: "medium",
              proposedAction: { type: "forward", to: "support@archinet.net" },
              rationale: "Customer asking for help",
              alsoMatched: [],
            },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Classified both." }],
        stop_reason: "end_turn",
      })
      // Micro-learn agent call for the corrected rule-backed proposal —
      // declines to propose an edit (text only, no tool call)
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "No minimal edit would help." }],
        stop_reason: "end_turn",
      });

    // --- Review: approve m1; correct m2 to flag-only with a note ---
    const rl = createMockRl("a", "c", "4", "Keep support triage manual for now");

    const loaded = await loadRules(rulesPath);
    const output: string[] = [];
    const summary = await runTriage({
      token: "graph-token",
      modelConfig: MODEL_CONFIG,
      identity: { name: "Clippy", emoji: "📎" },
      triage: TRIAGE_CONFIG,
      loaded,
      store,
      rl,
      out: (line) => output.push(line),
      options: {},
    });

    // --- Summary ---
    expect(summary).toMatchObject({
      fetched: 2, // m0 deduped
      classified: 2,
      approved: 1,
      corrected: 1,
      rejected: 0,
      failed: 0,
    });

    // --- Graph mutations ---
    const paths = mockGraphRequest.mock.calls.map((c) => c[0].path);
    expect(paths[0]).toContain("/me/mailFolders/inbox/messages");
    expect(paths).toContain("/me/messages/m1/move");
    const moveCall = mockGraphRequest.mock.calls.find(
      (c) => c[0].path === "/me/messages/m1/move",
    )![0];
    expect(moveCall.body).toEqual({ destinationId: "f-invoices" });
    const flagCall = mockGraphRequest.mock.calls.find(
      (c) => c[0].path === "/me/messages/m2",
    )![0];
    expect(flagCall.method).toBe("PATCH");
    expect(flagCall.body).toEqual({ flag: { flagStatus: "flagged" } });

    // --- Decision rows ---
    const decisions = store.listDecisions({ limit: 10 });
    const m1 = decisions.find((d) => d.messageId === "m1")!;
    expect(m1.verdict).toBe("approved");
    expect(m1.ruleId).toBe("vendor-invoices");
    expect(m1.ruleRevision).toBe(2);
    expect(m1.executedAt).not.toBeNull();

    const m2 = decisions.find((d) => d.messageId === "m2")!;
    expect(m2.verdict).toBe("corrected");
    expect(m2.correction).toEqual({
      ruleId: null,
      action: { type: "flag" },
      note: "Keep support triage manual for now",
    });
    expect(m2.executedAt).not.toBeNull();

    // --- Learning: resolved folder id cached back into the YAML,
    //     without a revision bump (machine bookkeeping only) ---
    const savedYaml = await readFile(rulesPath, "utf-8");
    expect(savedYaml).toContain("folderId: f-invoices");
    expect(savedYaml).toContain("revision: 2");

    // The correction is now an undistilled learning signal
    expect(summary.undistilled).toBe(1);
  });

  it("dry run classifies and persists skipped decisions without touching Graph", async () => {
    mockGraphRequest.mockResolvedValueOnce({
      value: [inboxMessage("m1", "<m1@t>", "billing@acme.com", "Invoice #77")],
    });
    mockCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "triage_record",
            input: {
              messageId: "m1",
              ruleId: "vendor-invoices",
              category: "vendor invoice",
              confidence: "high",
              proposedAction: { type: "move", folder: "Vendors/Invoices" },
              rationale: "Invoice",
              alsoMatched: [],
            },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Done." }],
        stop_reason: "end_turn",
      });

    const loaded = await loadRules(rulesPath);
    const summary = await runTriage({
      token: "graph-token",
      modelConfig: MODEL_CONFIG,
      identity: { name: "Clippy" },
      triage: TRIAGE_CONFIG,
      loaded,
      store,
      rl: createMockRl(),
      out: () => {},
      options: { dryRun: true },
    });

    expect(summary).toMatchObject({ fetched: 1, classified: 1, skipped: 1 });
    // Only the fetch hit Graph — no mutations
    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
    const row = store.listDecisions({ limit: 1 })[0];
    expect(row.verdict).toBe("skipped");
    // Skipped rows do not dedupe: the message reappears next run
    expect(store.hasDecidedMessage("<m1@t>")).toBe(false);
  });

  it("micro-learning proposes and applies a rule edit after a contradicting correction", async () => {
    mockGraphRequest
      .mockResolvedValueOnce({
        value: [
          inboxMessage("m1", "<m1@t>", "noreply@amazon.com", "Your order receipt"),
        ],
      })
      // corrected action: flag PATCH
      .mockResolvedValueOnce(undefined);

    mockCreate
      // Classification: misfire on vendor-invoices
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "triage_record",
            input: {
              messageId: "m1",
              ruleId: "vendor-invoices",
              category: "vendor invoice",
              confidence: "medium",
              proposedAction: { type: "move", folder: "Vendors/Invoices" },
              rationale: "Mentions payment",
              alsoMatched: [],
            },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Done." }],
        stop_reason: "end_turn",
      })
      // Micro-learn: propose the exclusion edit
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "triage_rule_edit",
            input: {
              newMatch:
                "Emails from vendors containing an invoice or payment request. NOT personal purchase receipts.",
            },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Edit recorded." }],
        stop_reason: "end_turn",
      });

    // correct → flag (option 4) → note → then 'y' to accept the rule edit
    const rl = createMockRl(
      "c",
      "4",
      "Personal receipts aren't vendor invoices",
      "y",
    );

    const loaded = await loadRules(rulesPath);
    await runTriage({
      token: "graph-token",
      modelConfig: MODEL_CONFIG,
      identity: { name: "Clippy" },
      triage: TRIAGE_CONFIG,
      loaded,
      store,
      rl,
      out: () => {},
      options: {},
    });

    // stringifyYaml folds long strings across lines — normalize before matching
    const savedYaml = (await readFile(rulesPath, "utf-8")).replace(/\s+/g, " ");
    expect(savedYaml).toContain("NOT personal purchase receipts");
    expect(savedYaml).toContain("revision: 3");

    const events = store.listRuleEvents("vendor-invoices");
    expect(events[0]).toMatchObject({ event: "edited", actor: "agent" });
    // The correction that drove the edit is already distilled
    expect(store.undistilledSignals()).toEqual([]);
  });
});
