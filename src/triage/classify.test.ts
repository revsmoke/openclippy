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

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { graphRequest } from "../graph/client.js";
import {
  classifyMessages,
  createTriageRecordTool,
  fetchMessagesToTriage,
} from "./classify.js";
import { TriageStore } from "./store.js";
import type { EmailEnvelope } from "./prompt.js";
import type { TriageRule } from "./rule-types.js";
import type { ModelConfig } from "../agents/model-config.js";

const mockGraphRequest = vi.mocked(graphRequest);

const MODEL_CONFIG: ModelConfig = {
  provider: "anthropic",
  model: "claude-test",
  apiKey: "sk-test",
  maxTokens: 4096,
};

const RULES: TriageRule[] = [
  {
    id: "vendor-invoices",
    name: "Vendor invoices",
    state: "active",
    priority: 20,
    match: "Vendor invoices and bills.",
    examples: [],
    action: { type: "move", folder: "Vendors/Invoices" },
    revision: 3,
  },
];

function envelope(overrides?: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "msg-1",
    internetMessageId: "<m1@acme.com>",
    from: "billing@acme.com",
    fromDomain: "acme.com",
    fromName: "Acme Billing",
    subject: "Invoice #4821",
    bodyPreview: "Please find attached invoice",
    receivedDateTime: "2026-07-01T10:00:00Z",
    hasAttachments: true,
    importance: "normal",
    ...overrides,
  };
}

function graphMessage(id: string, imid: string) {
  return {
    id,
    internetMessageId: imid,
    subject: `Subject ${id}`,
    bodyPreview: "preview text",
    from: { emailAddress: { address: "sender@test.com", name: "Sender" } },
    receivedDateTime: "2026-07-01T10:00:00Z",
    hasAttachments: false,
    importance: "normal",
    isRead: false,
  };
}

describe("fetchMessagesToTriage", () => {
  let store: TriageStore;

  beforeEach(() => {
    mockGraphRequest.mockReset();
    store = new TriageStore(":memory:");
  });

  it("fetches unread inbox envelopes with the right query", async () => {
    mockGraphRequest.mockResolvedValueOnce({
      value: [graphMessage("m1", "<1@t>"), graphMessage("m2", "<2@t>")],
    });

    const envelopes = await fetchMessagesToTriage({
      token: "t",
      store,
      limit: 25,
      snippetChars: 300,
    });

    expect(envelopes).toHaveLength(2);
    const call = mockGraphRequest.mock.calls[0][0];
    expect(call.path).toContain("/me/mailFolders/inbox/messages");
    expect(call.path).toContain("internetMessageId");
    expect(call.path).toContain("$filter=isRead eq false");
  });

  it("omits the unread filter with includeRead and respects custom folders", async () => {
    mockGraphRequest.mockResolvedValueOnce({ value: [] });
    await fetchMessagesToTriage({
      token: "t",
      store,
      limit: 10,
      snippetChars: 300,
      folder: "folder-id-123",
      includeRead: true,
    });
    const call = mockGraphRequest.mock.calls[0][0];
    expect(call.path).toContain("/me/mailFolders/folder-id-123/messages");
    expect(call.path).not.toContain("$filter");
  });

  it("dedupes messages already decided in prior runs", async () => {
    store.insertDecision({
      runId: null,
      messageId: "m1",
      internetMessageId: "<1@t>",
      features: {
        from: "x",
        fromDomain: "t",
        subject: "s",
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
      verdict: "approved",
    });

    mockGraphRequest.mockResolvedValueOnce({
      value: [graphMessage("m1", "<1@t>"), graphMessage("m2", "<2@t>")],
    });

    const envelopes = await fetchMessagesToTriage({
      token: "t",
      store,
      limit: 25,
      snippetChars: 300,
    });
    expect(envelopes.map((e) => e.id)).toEqual(["m2"]);
  });

  it("truncates previews to snippetChars", async () => {
    const long = { ...graphMessage("m1", "<1@t>"), bodyPreview: "x".repeat(500) };
    mockGraphRequest.mockResolvedValueOnce({ value: [long] });
    const envelopes = await fetchMessagesToTriage({
      token: "t",
      store,
      limit: 25,
      snippetChars: 100,
    });
    expect(envelopes[0].bodyPreview).toHaveLength(100);
  });
});

describe("createTriageRecordTool", () => {
  let store: TriageStore;

  beforeEach(() => {
    store = new TriageStore(":memory:");
  });

  function makeTool(results: never[] | unknown[] = []) {
    return createTriageRecordTool({
      rules: RULES,
      envelopes: [envelope()],
      store,
      runId: store.createRun(),
      results: results as [],
    });
  }

  it("rejects malformed records with isError so the model self-corrects", async () => {
    const tool = makeTool();
    const result = await tool.execute(
      { messageId: "msg-1", ruleId: "vendor-invoices" }, // missing fields
      { token: "" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid triage_record");
  });

  it("rejects unknown messageIds and ruleIds", async () => {
    const tool = makeTool();
    const badMsg = await tool.execute(
      {
        messageId: "not-in-batch",
        ruleId: null,
        category: "x",
        confidence: "low",
        proposedAction: { type: "none" },
        rationale: "r",
      },
      { token: "" },
    );
    expect(badMsg.isError).toBe(true);
    expect(badMsg.content).toContain("Unknown messageId");

    const badRule = await tool.execute(
      {
        messageId: "msg-1",
        ruleId: "no-such-rule",
        category: "x",
        confidence: "low",
        proposedAction: { type: "none" },
        rationale: "r",
      },
      { token: "" },
    );
    expect(badRule.isError).toBe(true);
    expect(badRule.content).toContain("Unknown ruleId");
  });

  it("requires reply_draft proposals to carry the drafted text", async () => {
    const tool = makeTool();
    const result = await tool.execute(
      {
        messageId: "msg-1",
        ruleId: null,
        category: "reply",
        confidence: "high",
        proposedAction: { type: "reply_draft", guidance: "ack" }, // no draft
        rationale: "r",
      },
      { token: "" },
    );
    expect(result.isError).toBe(true);
  });

  it("persists a pending decision snapshotting the rule revision", async () => {
    const results: unknown[] = [];
    const tool = makeTool(results);
    const ok = await tool.execute(
      {
        messageId: "msg-1",
        ruleId: "vendor-invoices",
        category: "vendor invoice",
        confidence: "high",
        proposedAction: { type: "move", folder: "Vendors/Invoices" },
        rationale: "Invoice attached",
        alsoMatched: [],
      },
      { token: "" },
    );
    expect(ok.isError).toBeUndefined();
    expect(results).toHaveLength(1);

    const row = store.getDecision(
      (results[0] as { decisionId: number }).decisionId,
    )!;
    expect(row.verdict).toBe("pending");
    expect(row.ruleRevision).toBe(3);
    expect(row.internetMessageId).toBe("<m1@acme.com>");

    // Duplicate records are rejected
    const dup = await tool.execute(
      {
        messageId: "msg-1",
        ruleId: null,
        category: "x",
        confidence: "low",
        proposedAction: { type: "none" },
        rationale: "r",
      },
      { token: "" },
    );
    expect(dup.isError).toBe(true);
    expect(dup.content).toContain("already recorded");
  });
});

describe("classifyMessages", () => {
  let store: TriageStore;

  beforeEach(() => {
    mockCreate.mockReset();
    store = new TriageStore(":memory:");
  });

  it("runs the agent per chunk, records proposals, reports unclassified", async () => {
    const envelopes = [
      envelope(),
      envelope({ id: "msg-2", internetMessageId: "<m2@t>", subject: "Lunch?" }),
    ];

    // One turn with a triage_record for each email, then a closing text turn
    mockCreate
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "triage_record",
            input: {
              messageId: "msg-1",
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

    const { proposals, unclassified } = await classifyMessages({
      envelopes,
      rules: RULES,
      modelConfig: MODEL_CONFIG,
      toolContext: { token: "t" },
      store,
      runId: store.createRun(),
      identity: { name: "Clippy" },
      chunkSize: 15,
      maxRules: 50,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].ruleId).toBe("vendor-invoices");
    expect(unclassified.map((e) => e.id)).toEqual(["msg-2"]);

    // Rules were rendered into the system prompt as context hints
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toContain("vendor-invoices");
    expect(callArgs.system).toContain("FIRST matching rule wins");
    // Envelopes were pre-embedded in the user message
    expect(callArgs.messages[0].content).toContain("Invoice #4821");
    expect(callArgs.messages[0].content).toContain("Lunch?");
    // The classification tool set is exactly [mail_read, triage_record]
    expect(
      (callArgs.tools as Array<{ name: string }>).map((t) => t.name),
    ).toEqual(["mail_read", "triage_record"]);
  });

  it("splits work into chunks of chunkSize", async () => {
    const envelopes = [
      envelope(),
      envelope({ id: "msg-2", internetMessageId: "<m2@t>" }),
      envelope({ id: "msg-3", internetMessageId: "<m3@t>" }),
    ];
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "No records." }],
      stop_reason: "end_turn",
    });

    await classifyMessages({
      envelopes,
      rules: RULES,
      modelConfig: MODEL_CONFIG,
      toolContext: { token: "t" },
      store,
      runId: store.createRun(),
      identity: { name: "Clippy" },
      chunkSize: 2,
      maxRules: 50,
    });

    // 2 chunks → 2 agent sessions → 2 create calls (each ends immediately)
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].messages[0].content).toContain("2 email(s)");
    expect(mockCreate.mock.calls[1][0].messages[0].content).toContain("1 email(s)");
  });
});
