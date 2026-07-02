/**
 * Triage phases 1–2: fetch (deterministic) and classify (agent).
 *
 * The classification agent run is *structurally* read-only: its tool set
 * is exactly [mail_read, triage_record]. triage_record is a per-run
 * collector tool — a closure over the loaded rule set and a results
 * array — so the agent can record proposals but cannot act on the
 * mailbox. The approval gate lives in the CLI, outside runAgent.
 */
import { graphRequestWithRetry } from "../graph/rate-limit.js";
import type { GraphCollectionResponse } from "../graph/client.js";
import type { GraphMessage } from "../services/mail/types.js";
import { mailReadTool } from "../services/mail/tools.js";
import { buildSystemPrompt } from "../agents/prompt-builder.js";
import { AgentSession } from "../agents/session.js";
import { runAgent } from "../agents/runtime.js";
import type { ModelConfig } from "../agents/model-config.js";
import type { AgentTool, ToolContext } from "../services/types.js";
import type { IdentityConfig } from "../config/types.agent.js";
import { triageRecordSchema } from "./rule-types.js";
import type {
  MessageFeatures,
  ProposedAction,
  SuggestedRule,
  TriageRule,
} from "./rule-types.js";
import type { TriageStore } from "./store.js";
import type { EmailEnvelope } from "./prompt.js";
import {
  buildClassifyMessage,
  renderRuleHints,
  selectRulesForBatch,
} from "./prompt.js";

const ENVELOPE_SELECT =
  "id,internetMessageId,subject,bodyPreview,from,receivedDateTime,hasAttachments,importance,isRead";

const WELL_KNOWN_SOURCE_FOLDERS = new Set([
  "inbox",
  "archive",
  "junkemail",
  "drafts",
  "sentitems",
  "deleteditems",
]);

function toEnvelope(m: GraphMessage, snippetChars: number): EmailEnvelope {
  const address = m.from?.emailAddress?.address ?? "";
  return {
    id: m.id,
    internetMessageId: m.internetMessageId ?? null,
    from: address,
    fromDomain: address.includes("@") ? address.split("@")[1] : "",
    fromName: m.from?.emailAddress?.name ?? "",
    subject: m.subject ?? "",
    bodyPreview: (m.bodyPreview ?? "").slice(0, snippetChars),
    receivedDateTime: m.receivedDateTime,
    hasAttachments: m.hasAttachments ?? false,
    importance: m.importance ?? "normal",
  };
}

export function envelopeFeatures(e: EmailEnvelope): MessageFeatures {
  return {
    from: e.from,
    fromDomain: e.fromDomain,
    subject: e.subject,
    snippet: e.bodyPreview,
    receivedAt: e.receivedDateTime,
    hasAttachments: e.hasAttachments,
    importance: e.importance,
  };
}

/**
 * Fetch message envelopes to triage. Pages with graphRequestWithRetry
 * (mail tools' plain graphRequest lacks retry) and dedupes against
 * already-decided messages via internet_message_id.
 */
export async function fetchMessagesToTriage(params: {
  token: string;
  store: TriageStore;
  limit: number;
  snippetChars: number;
  folder?: string;
  includeRead?: boolean;
}): Promise<EmailEnvelope[]> {
  const folder = params.folder ?? "inbox";
  const folderSegment = WELL_KNOWN_SOURCE_FOLDERS.has(folder.toLowerCase())
    ? folder.toLowerCase()
    : folder;

  const query = [
    `$select=${ENVELOPE_SELECT}`,
    "$orderby=receivedDateTime desc",
    `$top=${Math.min(params.limit, 50)}`,
    ...(params.includeRead ? [] : ["$filter=isRead eq false"]),
  ].join("&");

  let path: string | undefined =
    `/me/mailFolders/${folderSegment}/messages?${query}`;
  const envelopes: EmailEnvelope[] = [];
  let pages = 0;

  while (path && envelopes.length < params.limit && pages < 10) {
    const response: GraphCollectionResponse<GraphMessage> =
      await graphRequestWithRetry<GraphCollectionResponse<GraphMessage>>({
        token: params.token,
        path,
      });

    for (const msg of response.value ?? []) {
      if (envelopes.length >= params.limit) break;
      const envelope = toEnvelope(msg, params.snippetChars);
      if (
        envelope.internetMessageId &&
        params.store.hasDecidedMessage(envelope.internetMessageId)
      ) {
        continue; // already triaged in a prior run
      }
      envelopes.push(envelope);
    }

    path = response["@odata.nextLink"];
    pages++;
  }

  return envelopes;
}

/** In-memory classification result, joined to its persisted decision row. */
export type Proposal = {
  decisionId: number;
  envelope: EmailEnvelope;
  ruleId: string | null;
  ruleRevision: number | null;
  category: string;
  confidence: "high" | "medium" | "low";
  proposedAction: ProposedAction;
  rationale: string;
  alsoMatched: string[];
  suggestedRule: SuggestedRule | null;
};

/**
 * Build the per-run triage_record collector tool. Validates each record
 * against the batch and rule set, persists a pending decision row, and
 * accumulates proposals. Invalid input returns isError so the model
 * self-corrects.
 */
export function createTriageRecordTool(params: {
  rules: TriageRule[];
  envelopes: EmailEnvelope[];
  store: TriageStore;
  runId: string;
  results: Proposal[];
}): AgentTool {
  const envelopeById = new Map(params.envelopes.map((e) => [e.id, e]));
  const ruleById = new Map(params.rules.map((r) => [r.id, r]));

  return {
    name: "triage_record",
    description:
      "Record the triage classification for one email in this batch. " +
      "Call exactly once per email. ruleId must be one of the rule ids " +
      "from the system prompt, or null when no rule matches.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The messageId exactly as shown in the batch",
        },
        ruleId: {
          type: ["string", "null"],
          description: "Matched rule id, or null when no rule applies",
        },
        category: {
          type: "string",
          description: "Short category label, e.g. 'vendor invoice' or 'unmatched'",
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        proposedAction: {
          type: "object",
          description:
            "The matched rule's action (with concrete fields filled in), or " +
            "{type:'none'} when no rule matches. For reply_draft include the " +
            "full drafted reply text in 'draft'.",
        },
        rationale: {
          type: "string",
          description: "One sentence: why this rule (or no rule) matched",
        },
        alsoMatched: {
          type: "array",
          items: { type: "string" },
          description: "Other rule ids that plausibly matched",
        },
        suggestedRule: {
          type: "object",
          description:
            "Optional draft rule {name, match, action?} when no existing rule " +
            "matched but the email fits a clear repeated pattern",
        },
      },
      required: [
        "messageId",
        "ruleId",
        "category",
        "confidence",
        "proposedAction",
        "rationale",
      ],
    },
    execute: async (input) => {
      const parsed = triageRecordSchema.safeParse(input);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        return { content: `Invalid triage_record: ${detail}`, isError: true };
      }
      const record = parsed.data;

      const envelope = envelopeById.get(record.messageId);
      if (!envelope) {
        return {
          content: `Unknown messageId "${record.messageId}" — use a messageId from this batch.`,
          isError: true,
        };
      }
      if (params.results.some((r) => r.envelope.id === record.messageId)) {
        return {
          content: `Email ${record.messageId} was already recorded. Record each email exactly once.`,
          isError: true,
        };
      }

      let ruleRevision: number | null = null;
      if (record.ruleId !== null) {
        const rule = ruleById.get(record.ruleId);
        if (!rule) {
          return {
            content: `Unknown ruleId "${record.ruleId}" — use a rule id from the system prompt, or null.`,
            isError: true,
          };
        }
        ruleRevision = rule.revision;
      }

      const decisionId = params.store.insertDecision({
        runId: params.runId,
        messageId: envelope.id,
        internetMessageId: envelope.internetMessageId,
        features: envelopeFeatures(envelope),
        ruleId: record.ruleId,
        ruleRevision,
        category: record.category,
        proposedAction: record.proposedAction,
        confidence: record.confidence,
        rationale: record.rationale,
        alsoMatched: record.alsoMatched,
        suggestedRule: record.suggestedRule ?? null,
      });

      params.results.push({
        decisionId,
        envelope,
        ruleId: record.ruleId,
        ruleRevision,
        category: record.category,
        confidence: record.confidence,
        proposedAction: record.proposedAction,
        rationale: record.rationale,
        alsoMatched: record.alsoMatched,
        suggestedRule: record.suggestedRule ?? null,
      });

      return {
        content: `Recorded ${params.results.length}/${params.envelopes.length}.`,
      };
    },
  };
}

/**
 * Classify envelopes in chunks. Each chunk is a fresh agent session with
 * tools [mail_read, triage_record] and the rules rendered as contextHints.
 */
export async function classifyMessages(params: {
  envelopes: EmailEnvelope[];
  rules: TriageRule[];
  modelConfig: ModelConfig;
  toolContext: ToolContext;
  store: TriageStore;
  runId: string;
  identity: IdentityConfig;
  chunkSize: number;
  maxRules: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ proposals: Proposal[]; unclassified: EmailEnvelope[] }> {
  const proposals: Proposal[] = [];

  for (let i = 0; i < params.envelopes.length; i += params.chunkSize) {
    const chunk = params.envelopes.slice(i, i + params.chunkSize);
    const chunkRules = selectRulesForBatch(params.rules, chunk, params.maxRules);

    const collector = createTriageRecordTool({
      rules: chunkRules,
      envelopes: chunk,
      store: params.store,
      runId: params.runId,
      results: proposals,
    });

    const systemPrompt = buildSystemPrompt({
      identity: params.identity,
      services: [],
      contextHints: renderRuleHints(chunkRules),
    });

    await runAgent({
      message: buildClassifyMessage(chunk),
      session: new AgentSession(),
      modelConfig: params.modelConfig,
      tools: [mailReadTool(), collector],
      systemPrompt,
      toolContext: params.toolContext,
      maxTurns: 2 * chunk.length + 2,
    });

    params.onProgress?.(
      Math.min(i + params.chunkSize, params.envelopes.length),
      params.envelopes.length,
    );
  }

  const recorded = new Set(proposals.map((p) => p.envelope.id));
  const unclassified = params.envelopes.filter((e) => !recorded.has(e.id));
  return { proposals, unclassified };
}
