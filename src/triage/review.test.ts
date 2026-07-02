import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../graph/client.js", () => ({
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

import { graphRequest } from "../graph/client.js";
import { reviewProposals } from "./review.js";
import { FolderResolver } from "./executor.js";
import { TriageStore } from "./store.js";
import { createMockRl } from "../test-utils/mock-rl.js";
import type { Proposal } from "./classify.js";
import type { TriageRule } from "./rule-types.js";
import type { EmailEnvelope } from "./prompt.js";

const mockGraphRequest = vi.mocked(graphRequest);

const RULES: TriageRule[] = [
  {
    id: "vendor-invoices",
    name: "Vendor invoices",
    state: "active",
    priority: 20,
    match: "Vendor invoices.",
    examples: [],
    action: { type: "move", folder: "Vendors" },
    revision: 1,
  },
  {
    id: "urgent",
    name: "Urgent",
    state: "trusted",
    priority: 10,
    match: "Urgent requests.",
    examples: [],
    action: { type: "flag" },
    revision: 2,
  },
];

function envelope(id: string, subject: string): EmailEnvelope {
  return {
    id,
    internetMessageId: `<${id}@t>`,
    from: "sender@test.com",
    fromDomain: "test.com",
    fromName: "Sender",
    subject,
    bodyPreview: "preview",
    receivedDateTime: "2026-07-01T10:00:00Z",
    hasAttachments: false,
    importance: "normal",
  };
}

describe("reviewProposals", () => {
  let store: TriageStore;

  beforeEach(() => {
    mockGraphRequest.mockReset();
    store = new TriageStore(":memory:");
  });

  function makeProposal(
    id: string,
    overrides?: Partial<Proposal>,
  ): Proposal {
    const env = envelope(id, `Subject ${id}`);
    const decisionId = store.insertDecision({
      runId: null,
      messageId: env.id,
      internetMessageId: env.internetMessageId,
      features: {
        from: env.from,
        fromDomain: env.fromDomain,
        subject: env.subject,
        snippet: env.bodyPreview,
        receivedAt: env.receivedDateTime,
        hasAttachments: false,
        importance: "normal",
      },
      ruleId: overrides?.ruleId !== undefined ? overrides.ruleId : "vendor-invoices",
      ruleRevision: 1,
      category: "vendor invoice",
      proposedAction: overrides?.proposedAction ?? { type: "flag" },
      confidence: overrides?.confidence ?? "high",
      rationale: "because",
    });
    return {
      decisionId,
      envelope: env,
      ruleId: "vendor-invoices",
      ruleRevision: 1,
      category: "vendor invoice",
      confidence: "high",
      proposedAction: { type: "flag" },
      rationale: "because",
      alsoMatched: [],
      suggestedRule: null,
      ...overrides,
    };
  }

  function deps(rl: ReturnType<typeof createMockRl>, autoAct = false) {
    return {
      rl,
      store,
      token: "t",
      folders: new FolderResolver("t"),
      rules: RULES,
      autoAct,
      out: () => {},
    };
  }

  it("approve executes the action and persists the verdict", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const p = makeProposal("m1");
    const rl = createMockRl("a");

    const { outcomes } = await reviewProposals([p], deps(rl));

    expect(outcomes[0].verdict).toBe("approved");
    expect(mockGraphRequest).toHaveBeenCalledTimes(1); // the flag PATCH
    const row = store.getDecision(p.decisionId)!;
    expect(row.verdict).toBe("approved");
    expect(row.executedAt).not.toBeNull();
  });

  it("reject persists the verdict and takes no action", async () => {
    const p = makeProposal("m1");
    const rl = createMockRl("r");

    const { outcomes } = await reviewProposals([p], deps(rl));

    expect(outcomes[0].verdict).toBe("rejected");
    expect(mockGraphRequest).not.toHaveBeenCalled();
    expect(store.getDecision(p.decisionId)!.executedAt).toBeNull();
  });

  it("skip and quit leave proposals pending-safe as skipped", async () => {
    const p1 = makeProposal("m1");
    const p2 = makeProposal("m2");
    const p3 = makeProposal("m3");
    const rl = createMockRl("s", "q"); // skip first, quit → rest skipped

    const { outcomes } = await reviewProposals([p1, p2, p3], deps(rl));

    expect(outcomes.map((o) => o.verdict)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(mockGraphRequest).not.toHaveBeenCalled();
  });

  it("correct executes the user's choice immediately and records the correction", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const p = makeProposal("m1");
    // c → correct; menu option 4 = flag (rule/move/forward/flag/...); note
    const rl = createMockRl("c", "4", "This should just be flagged");

    const { outcomes } = await reviewProposals([p], deps(rl));

    expect(outcomes[0].verdict).toBe("corrected");
    expect(outcomes[0].correction).toEqual({
      ruleId: null,
      action: { type: "flag" },
      note: "This should just be flagged",
    });
    // Corrected action executed immediately
    expect(mockGraphRequest).toHaveBeenCalledTimes(1);
    expect(mockGraphRequest.mock.calls[0][0].body).toEqual({
      flag: { flagStatus: "flagged" },
    });
    const row = store.getDecision(p.decisionId)!;
    expect(row.verdict).toBe("corrected");
    expect(row.correction?.note).toBe("This should just be flagged");
    expect(row.executedAt).not.toBeNull();
  });

  it("correct → apply a different rule uses that rule's action", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const p = makeProposal("m1");
    // c → option 1 (different rule) → rule 2 (urgent, flag) → empty note
    const rl = createMockRl("c", "1", "2", "");

    const { outcomes } = await reviewProposals([p], deps(rl));

    expect(outcomes[0].verdict).toBe("corrected");
    expect(outcomes[0].correction).toEqual({
      ruleId: "urgent",
      action: { type: "flag" },
    });
  });

  it("'A' approves remaining high-confidence but keeps asking for low/reply_draft", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const high1 = makeProposal("m1", { confidence: "high" });
    const draft = makeProposal("m2", {
      confidence: "high",
      proposedAction: {
        type: "reply_draft",
        guidance: "ack",
        draft: "On it!",
      },
    });
    const low = makeProposal("m3", { confidence: "low" });
    const high2 = makeProposal("m4", { confidence: "high" });

    // A on first (approves it + future high); reply_draft asked → r; low asked → s
    const rl = createMockRl("A", "r", "s");

    const { outcomes } = await reviewProposals(
      [high1, draft, low, high2],
      deps(rl),
    );

    expect(outcomes.map((o) => o.verdict)).toEqual([
      "approved", // high1 via A
      "rejected", // reply_draft still asked individually
      "skipped", // low still asked individually
      "approved", // high2 auto-approved
    ]);
  });

  it("autoAct executes trusted+high-confidence proposals without asking", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const trusted = makeProposal("m1", { ruleId: "urgent" });
    const activeRule = makeProposal("m2"); // vendor-invoices is active → still asked
    const rl = createMockRl("r");

    const { outcomes } = await reviewProposals(
      [trusted, activeRule],
      deps(rl, true),
    );

    expect(outcomes[0].verdict).toBe("auto");
    expect(outcomes[1].verdict).toBe("rejected");
    expect(store.getDecision(trusted.decisionId)!.verdict).toBe("auto");
    expect(store.getDecision(trusted.decisionId)!.executedAt).not.toBeNull();
  });

  it("never auto-acts reply_draft even for trusted rules", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const draft = makeProposal("m1", {
      ruleId: "urgent",
      proposedAction: { type: "reply_draft", guidance: "g", draft: "Hello" },
    });
    const rl = createMockRl("r");

    const { outcomes } = await reviewProposals([draft], deps(rl, true));

    expect(outcomes[0].verdict).toBe("rejected");
    expect(mockGraphRequest).not.toHaveBeenCalled();
  });

  it("records execution failures on the decision row", async () => {
    mockGraphRequest.mockRejectedValue(new Error("boom"));
    const p = makeProposal("m1");
    const rl = createMockRl("a");

    const { outcomes } = await reviewProposals([p], deps(rl));

    expect(outcomes[0].verdict).toBe("approved");
    expect(outcomes[0].execution?.ok).toBe(false);
    expect(store.getDecision(p.decisionId)!.error).toContain("boom");
  });

  it("collects folder id updates for the rule cache", async () => {
    // move with no cached id → resolve by name → move
    mockGraphRequest
      .mockResolvedValueOnce({ value: [{ id: "fid-1", displayName: "Vendors" }] })
      .mockResolvedValueOnce({ id: "moved" });
    const p = makeProposal("m1", {
      proposedAction: { type: "move", folder: "Vendors" },
    });
    const rl = createMockRl("a");

    const { folderIdUpdates } = await reviewProposals([p], deps(rl));

    expect(folderIdUpdates.get("vendor-invoices")).toBe("fid-1");
  });
});
