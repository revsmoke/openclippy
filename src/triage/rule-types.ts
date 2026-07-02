/**
 * Triage rule schema — the structured envelope around natural-language
 * match criteria. Rules live in ~/.openclippy/triage/rules.yaml (the
 * user's editable asset); everything here is zod-validated on load.
 */
import { z } from "zod";

/** Hard limits that keep the rule set prompt-sized and drift-resistant. */
export const MATCH_MAX_CHARS = 400;
export const MAX_EXAMPLES_PER_RULE = 5;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const moveAction = z.object({
  type: z.literal("move"),
  /** Folder display name or path like "Vendors/Invoices" */
  folder: z.string().min(1),
  /** Cached Graph folder ID — re-resolved by name when stale */
  folderId: z.string().optional(),
});

const forwardAction = z.object({
  type: z.literal("forward"),
  /** SMTP address — may be an M365 Group mailbox */
  to: z.string().min(1),
  comment: z.string().optional(),
  alsoFlag: z.boolean().optional(),
});

const replyDraftAction = z.object({
  type: z.literal("reply_draft"),
  /** Instructions for the agent when drafting the reply */
  guidance: z.string().min(1),
});

const flagAction = z.object({ type: z.literal("flag") });

const prioritizeAction = z.object({
  type: z.literal("prioritize"),
  importance: z.enum(["low", "normal", "high"]),
});

const categorizeAction = z.object({
  type: z.literal("categorize"),
  categories: z.array(z.string().min(1)).min(1),
});

const noneAction = z.object({ type: z.literal("none") });

/** Action as stored in a rule definition. */
export const ruleActionSchema = z.discriminatedUnion("type", [
  moveAction,
  forwardAction,
  replyDraftAction,
  flagAction,
  prioritizeAction,
  categorizeAction,
  noneAction,
]);

/**
 * Action as proposed for a specific message. Identical to ruleActionSchema
 * except reply_draft must carry the concrete drafted text — mail_reply sends
 * immediately, so the draft is held in the decision row until approved.
 */
export const proposedActionSchema = z.discriminatedUnion("type", [
  moveAction,
  forwardAction,
  replyDraftAction.extend({ draft: z.string().min(1) }),
  flagAction,
  prioritizeAction,
  categorizeAction,
  noneAction,
]);

export type RuleAction = z.infer<typeof ruleActionSchema>;
export type ProposedAction = z.infer<typeof proposedActionSchema>;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const ruleStateSchema = z.enum([
  "proposed",
  "active",
  "trusted",
  "retired",
]);
export type RuleState = z.infer<typeof ruleStateSchema>;

export const ruleExampleSchema = z.object({
  kind: z.enum(["positive", "negative"]),
  from: z.string().optional(),
  subject: z.string().optional(),
  /** Short body snippet only — never full bodies */
  snippet: z.string().optional(),
});
export type RuleExample = z.infer<typeof ruleExampleSchema>;

export const triageRuleSchema = z.object({
  /** Stable slug — join key for stats and the audit trail */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug"),
  name: z.string().min(1),
  state: ruleStateSchema.default("active"),
  /** Lower wins conflicts; rules are rendered in this order */
  priority: z.number().int().default(100),
  /** The LLM-evaluated natural-language criteria */
  match: z.string().min(1).max(MATCH_MAX_CHARS),
  /** Optional deterministic prefilter used when the rule set exceeds maxRules */
  hints: z
    .object({
      domains: z.array(z.string()).default([]),
      senders: z.array(z.string()).default([]),
    })
    .optional(),
  examples: z.array(ruleExampleSchema).max(MAX_EXAMPLES_PER_RULE).default([]),
  action: ruleActionSchema,
  notes: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  /** Bumped on every match/action/priority change */
  revision: z.number().int().min(1).default(1),
});
export type TriageRule = z.infer<typeof triageRuleSchema>;

export const rulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(triageRuleSchema).default([]),
});
export type RulesFile = z.infer<typeof rulesFileSchema>;

// ---------------------------------------------------------------------------
// Classification records (triage_record collector tool input)
// ---------------------------------------------------------------------------

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const suggestedRuleSchema = z.object({
  name: z.string().min(1),
  match: z.string().min(1).max(MATCH_MAX_CHARS),
  action: ruleActionSchema.optional(),
});
export type SuggestedRule = z.infer<typeof suggestedRuleSchema>;

export const triageRecordSchema = z.object({
  messageId: z.string().min(1),
  /** Matched rule id, or null when no rule applies */
  ruleId: z.string().nullable(),
  /** Short human category label, e.g. "vendor invoice" or "unmatched" */
  category: z.string().min(1),
  confidence: confidenceSchema,
  proposedAction: proposedActionSchema,
  rationale: z.string().min(1),
  /** Other rule ids that plausibly matched (for merge detection) */
  alsoMatched: z.array(z.string()).default([]),
  /** Optional draft rule when no existing rule matched but a pattern is clear */
  suggestedRule: suggestedRuleSchema.optional(),
});
export type TriageRecord = z.infer<typeof triageRecordSchema>;

// ---------------------------------------------------------------------------
// Decisions & verdicts (shared shapes for store + review)
// ---------------------------------------------------------------------------

export type Verdict =
  | "pending"
  | "approved"
  | "rejected"
  | "corrected"
  | "skipped"
  | "auto";

/** What the user chose instead, recorded as the learning signal. */
export type Correction = {
  ruleId: string | null;
  action: ProposedAction;
  note?: string;
};

/** Privacy-bounded message features stored per decision — no full bodies. */
export type MessageFeatures = {
  from: string;
  fromDomain: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  hasAttachments: boolean;
  importance: string;
};

/** Compact description of an action for CLI display. */
export function describeAction(action: RuleAction | ProposedAction): string {
  switch (action.type) {
    case "move":
      return `move → ${action.folder}`;
    case "forward":
      return `forward → ${action.to}${action.alsoFlag ? " (+flag)" : ""}`;
    case "reply_draft":
      return "draft reply";
    case "flag":
      return "flag";
    case "prioritize":
      return `set importance → ${action.importance}`;
    case "categorize":
      return `categorize → ${action.categories.join(", ")}`;
    case "none":
      return "no action";
  }
}
