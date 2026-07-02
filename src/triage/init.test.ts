import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { runInit } from "./init.js";
import { loadRules } from "./rules-file.js";
import { TriageStore } from "./store.js";
import { createMockRl } from "../test-utils/mock-rl.js";
import type { ModelConfig } from "../agents/model-config.js";

const mockGraphRequest = vi.mocked(graphRequest);

const MODEL_CONFIG: ModelConfig = {
  provider: "anthropic",
  model: "claude-test",
  apiKey: "sk-test",
  maxTokens: 4096,
};

const EMPTY_RULES = "version: 1\nrules: []\n";

describe("triage init", () => {
  let dir: string;
  let rulesPath: string;
  let store: TriageStore;

  beforeEach(async () => {
    mockGraphRequest.mockReset();
    mockCreate.mockReset();
    dir = await mkdtemp(join(tmpdir(), "triage-init-"));
    rulesPath = join(dir, "rules.yaml");
    await writeFile(rulesPath, EMPTY_RULES, "utf-8");
    store = new TriageStore(":memory:");
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("bootstraps rules from folders and the interview", async () => {
    mockGraphRequest
      // Folder list: one custom folder, defaults filtered out
      .mockResolvedValueOnce({
        value: [
          { id: "f-inbox", displayName: "Inbox", totalItemCount: 50 },
          { id: "f-sent", displayName: "Sent Items", totalItemCount: 10 },
          { id: "f-vendors", displayName: "Vendors", totalItemCount: 12 },
          { id: "f-empty", displayName: "Empty", totalItemCount: 0 },
        ],
      })
      // Samples for "Vendors"
      .mockResolvedValueOnce({
        value: [
          {
            id: "s1",
            subject: "Invoice #1",
            bodyPreview: "Amount due...",
            from: { emailAddress: { address: "billing@acme.com" } },
          },
        ],
      });

    mockCreate
      // Folder-bootstrap drafts
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "triage_rules_draft",
            input: {
              rules: [
                {
                  id: "vendors",
                  name: "Vendor mail",
                  match: "Invoices and billing from vendors.",
                  action: { type: "move", folder: "Vendors" },
                },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Drafted." }],
        stop_reason: "end_turn",
      })
      // Interview drafts
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "triage_rules_draft",
            input: {
              rules: [
                {
                  id: "boss-priority",
                  name: "Boss priority",
                  match: "Emails from the user's manager.",
                  action: { type: "prioritize", importance: "high" },
                },
              ],
            },
          },
        ],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Drafted." }],
        stop_reason: "end_turn",
      });

    // multiSelect: Enter → keep pre-selected folder drafts;
    // interview: answer Q1, skip Q2-Q5; confirm the interview rule
    const rl = createMockRl("", "my manager Dana", "", "", "", "", "y");

    const { created } = await runInit({
      token: "t",
      modelConfig: MODEL_CONFIG,
      identity: { name: "Clippy" },
      loaded: await loadRules(rulesPath),
      store,
      rl,
      out: () => {},
    });

    expect(created).toBe(2);
    const saved = await loadRules(rulesPath);
    expect(saved.file.rules.map((r) => r.id).sort()).toEqual([
      "boss-priority",
      "vendors",
    ]);
    expect(saved.file.rules.every((r) => r.state === "active")).toBe(true);

    // Audit trail
    expect(store.listRuleEvents("vendors")[0]).toMatchObject({
      event: "created",
      actor: "bootstrap",
    });

    // Only the custom, non-empty folder was sampled
    const samplePaths = mockGraphRequest.mock.calls
      .map((c) => c[0].path)
      .filter((p) => p.includes("/messages"));
    expect(samplePaths).toHaveLength(1);
    expect(samplePaths[0]).toContain("f-vendors");
  });

  it("zero rules is a valid outcome", async () => {
    mockGraphRequest.mockResolvedValueOnce({ value: [] }); // no folders
    // Interview: skip everything → no agent call, nothing created
    const rl = createMockRl("", "", "", "", "");

    const output: string[] = [];
    const { created } = await runInit({
      token: "t",
      modelConfig: MODEL_CONFIG,
      identity: { name: "Clippy" },
      loaded: await loadRules(rulesPath),
      store,
      rl,
      out: (l) => output.push(l),
    });

    expect(created).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("No rules created");
    // File untouched
    const saved = await loadRules(rulesPath);
    expect(saved.file.rules).toEqual([]);
  });
});
