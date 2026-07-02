/**
 * Prompt assembly for triage classification: renders the rule set into
 * contextHints for buildSystemPrompt, and pre-embeds email envelopes
 * into the classification user message.
 */
import type { TriageRule } from "./rule-types.js";
import { describeAction } from "./rule-types.js";

/** Envelope fields fetched per message — never the full body. */
export type EmailEnvelope = {
  id: string;
  internetMessageId: string | null;
  from: string;
  fromDomain: string;
  fromName: string;
  subject: string;
  bodyPreview: string;
  receivedDateTime: string;
  hasAttachments: boolean;
  importance: string;
};

/**
 * When the rule set exceeds maxRules, prefilter deterministically using
 * each rule's hints against the batch's sender domains/addresses.
 * Hint-less rules are always included — they have no deterministic
 * signature, so only the LLM can evaluate them.
 */
export function selectRulesForBatch(
  rules: TriageRule[],
  envelopes: EmailEnvelope[],
  maxRules: number,
): TriageRule[] {
  if (rules.length <= maxRules) return rules;

  const domains = new Set(envelopes.map((e) => e.fromDomain.toLowerCase()));
  const senders = new Set(envelopes.map((e) => e.from.toLowerCase()));

  const relevant = rules.filter((r) => {
    if (!r.hints || (r.hints.domains.length === 0 && r.hints.senders.length === 0)) {
      return true; // hint-less rules always included
    }
    return (
      r.hints.domains.some((d) => domains.has(d.toLowerCase())) ||
      r.hints.senders.some((s) => senders.has(s.toLowerCase()))
    );
  });

  return relevant.slice(0, Math.max(maxRules, 1));
}

/** One contextHint per rule + a protocol header, for buildSystemPrompt. */
export function renderRuleHints(rules: TriageRule[]): string[] {
  const hints: string[] = [
    "You are triaging the user's inbox against their saved rules. " +
      "Evaluate the rules below top-to-bottom; the FIRST matching rule wins. " +
      "If other rules also plausibly match, list their ids in alsoMatched. " +
      "If no rule matches, record ruleId: null with proposedAction type 'none' " +
      "(and, when you see a clear repeated pattern, include a suggestedRule). " +
      "Record exactly one triage_record per email. Use mail_read only when the " +
      "envelope is genuinely ambiguous.",
  ];

  for (const rule of rules) {
    const examples = rule.examples
      .map(
        (ex) =>
          `${ex.kind === "positive" ? "e.g." : "NOT e.g."} from=${ex.from ?? "?"} subject="${ex.subject ?? ""}"`,
      )
      .join("; ");
    hints.push(
      `Rule "${rule.id}" (priority ${rule.priority}): ${rule.match.trim()} ` +
        `→ action: ${describeAction(rule.action)}${examples ? ` [${examples}]` : ""}`,
    );
  }

  return hints;
}

/** Pre-embed the batch's envelopes into the classification user message. */
export function buildClassifyMessage(envelopes: EmailEnvelope[]): string {
  const lines: string[] = [
    `Classify the following ${envelopes.length} email(s). ` +
      "Call triage_record exactly once for each, using the messageId shown.",
    "",
  ];

  envelopes.forEach((e, i) => {
    lines.push(
      `--- Email ${i + 1} ---`,
      `messageId: ${e.id}`,
      `From: ${e.fromName ? `${e.fromName} <${e.from}>` : e.from}`,
      `Subject: ${e.subject || "(no subject)"}`,
      `Received: ${e.receivedDateTime}`,
      `Importance: ${e.importance}${e.hasAttachments ? " | Has attachments" : ""}`,
      `Preview: ${e.bodyPreview}`,
      "",
    );
  });

  return lines.join("\n");
}
