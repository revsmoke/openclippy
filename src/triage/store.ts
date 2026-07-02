/**
 * Persistent triage store backed by SQLite (better-sqlite3).
 *
 * Lives in ~/.openclippy/triage.db — deliberately separate from memory.db
 * so wiping chat memory never destroys the triage learning data.
 *
 * Holds the decision log (every classification + the user's verdict on
 * it), run metadata, and the rule audit trail. Rule *definitions* live in
 * rules.yaml; stats are always derived from decisions here, never stored
 * in the YAML.
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Correction,
  MessageFeatures,
  ProposedAction,
  SuggestedRule,
  Verdict,
} from "./rule-types.js";

export type DecisionRow = {
  id: number;
  runId: string | null;
  messageId: string;
  internetMessageId: string | null;
  features: MessageFeatures;
  ruleId: string | null;
  ruleRevision: number | null;
  category: string;
  proposedAction: ProposedAction;
  confidence: "high" | "medium" | "low";
  rationale: string;
  alsoMatched: string[];
  suggestedRule: SuggestedRule | null;
  verdict: Verdict;
  correction: Correction | null;
  executedAt: number | null;
  error: string | null;
  distilledAt: number | null;
  decidedAt: number;
  verdictAt: number | null;
};

export type RuleAccuracyRow = {
  ruleId: string;
  fired: number;
  approved: number;
  rejected: number;
  corrected: number;
  auto: number;
  lastDecidedAt: number | null;
};

export type RuleEvent = {
  ruleId: string;
  revision: number;
  event:
    | "created"
    | "edited"
    | "example_added"
    | "promoted"
    | "demoted"
    | "retired"
    | "merged";
  actor: "user" | "agent" | "refine" | "bootstrap";
  oldBody?: string;
  newBody?: string;
  /** Decision ids (or other references) backing this change */
  evidence?: unknown;
};

type RawDecisionRow = {
  id: number;
  run_id: string | null;
  message_id: string;
  internet_message_id: string | null;
  features: string;
  rule_id: string | null;
  rule_revision: number | null;
  category: string;
  proposed_action: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  also_matched: string | null;
  suggested_rule: string | null;
  verdict: Verdict;
  correction: string | null;
  executed_at: number | null;
  error: string | null;
  distilled_at: number | null;
  decided_at: number;
  verdict_at: number | null;
};

function rowToDecision(row: RawDecisionRow): DecisionRow {
  return {
    id: row.id,
    runId: row.run_id,
    messageId: row.message_id,
    internetMessageId: row.internet_message_id,
    features: JSON.parse(row.features) as MessageFeatures,
    ruleId: row.rule_id,
    ruleRevision: row.rule_revision,
    category: row.category,
    proposedAction: JSON.parse(row.proposed_action) as ProposedAction,
    confidence: row.confidence,
    rationale: row.rationale,
    alsoMatched: row.also_matched
      ? (JSON.parse(row.also_matched) as string[])
      : [],
    suggestedRule: row.suggested_rule
      ? (JSON.parse(row.suggested_rule) as SuggestedRule)
      : null,
    verdict: row.verdict,
    correction: row.correction
      ? (JSON.parse(row.correction) as Correction)
      : null,
    executedAt: row.executed_at,
    error: row.error,
    distilledAt: row.distilled_at,
    decidedAt: row.decided_at,
    verdictAt: row.verdict_at,
  };
}

export class TriageStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS triage_runs (",
        "  id TEXT PRIMARY KEY,",
        "  started_at INTEGER NOT NULL,",
        "  finished_at INTEGER,",
        "  message_count INTEGER NOT NULL DEFAULT 0,",
        "  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'webhook'))",
        ");",
        "",
        "CREATE TABLE IF NOT EXISTS decisions (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  run_id TEXT REFERENCES triage_runs(id),",
        "  message_id TEXT NOT NULL,",
        "  internet_message_id TEXT,",
        "  features TEXT NOT NULL,",
        "  rule_id TEXT,",
        "  rule_revision INTEGER,",
        "  category TEXT NOT NULL,",
        "  proposed_action TEXT NOT NULL,",
        "  confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low')),",
        "  rationale TEXT NOT NULL DEFAULT '',",
        "  also_matched TEXT,",
        "  suggested_rule TEXT,",
        "  verdict TEXT NOT NULL DEFAULT 'pending' CHECK(verdict IN ('pending', 'approved', 'rejected', 'corrected', 'skipped', 'auto')),",
        "  correction TEXT,",
        "  executed_at INTEGER,",
        "  error TEXT,",
        "  distilled_at INTEGER,",
        "  decided_at INTEGER NOT NULL,",
        "  verdict_at INTEGER",
        ");",
        "",
        "CREATE INDEX IF NOT EXISTS idx_decisions_imid ON decisions(internet_message_id);",
        "CREATE INDEX IF NOT EXISTS idx_decisions_rule ON decisions(rule_id);",
        "CREATE INDEX IF NOT EXISTS idx_decisions_verdict ON decisions(verdict);",
        "",
        "CREATE TABLE IF NOT EXISTS rule_events (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  rule_id TEXT NOT NULL,",
        "  revision INTEGER NOT NULL,",
        "  event TEXT NOT NULL CHECK(event IN ('created', 'edited', 'example_added', 'promoted', 'demoted', 'retired', 'merged')),",
        "  actor TEXT NOT NULL CHECK(actor IN ('user', 'agent', 'refine', 'bootstrap')),",
        "  old_body TEXT,",
        "  new_body TEXT,",
        "  evidence TEXT,",
        "  created_at INTEGER NOT NULL",
        ");",
        "",
        "CREATE INDEX IF NOT EXISTS idx_rule_events_rule ON rule_events(rule_id);",
        "",
        "CREATE TABLE IF NOT EXISTS meta (",
        "  key TEXT PRIMARY KEY,",
        "  value TEXT NOT NULL",
        ");",
        "",
        "CREATE VIEW IF NOT EXISTS rule_accuracy AS",
        "  SELECT rule_id,",
        "    COUNT(*) AS fired,",
        "    SUM(CASE WHEN verdict = 'approved' THEN 1 ELSE 0 END) AS approved,",
        "    SUM(CASE WHEN verdict = 'rejected' THEN 1 ELSE 0 END) AS rejected,",
        "    SUM(CASE WHEN verdict = 'corrected' THEN 1 ELSE 0 END) AS corrected,",
        "    SUM(CASE WHEN verdict = 'auto' THEN 1 ELSE 0 END) AS auto,",
        "    MAX(decided_at) AS last_decided_at",
        "  FROM decisions",
        "  WHERE rule_id IS NOT NULL AND verdict != 'pending' AND verdict != 'skipped'",
        "  GROUP BY rule_id;",
      ].join("\n"),
    );
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  createRun(source: "manual" | "webhook" = "manual"): string {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO triage_runs (id, started_at, source) VALUES (?, ?, ?)",
      )
      .run(id, Date.now(), source);
    return id;
  }

  finishRun(runId: string, messageCount: number): void {
    this.db
      .prepare(
        "UPDATE triage_runs SET finished_at = ?, message_count = ? WHERE id = ?",
      )
      .run(Date.now(), messageCount, runId);
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  insertDecision(params: {
    runId: string | null;
    messageId: string;
    internetMessageId: string | null;
    features: MessageFeatures;
    ruleId: string | null;
    ruleRevision: number | null;
    category: string;
    proposedAction: ProposedAction;
    confidence: "high" | "medium" | "low";
    rationale: string;
    alsoMatched?: string[];
    suggestedRule?: SuggestedRule | null;
    verdict?: Verdict;
    correction?: Correction | null;
  }): number {
    const result = this.db
      .prepare(
        "INSERT INTO decisions (run_id, message_id, internet_message_id, features, " +
          "rule_id, rule_revision, category, proposed_action, confidence, rationale, " +
          "also_matched, suggested_rule, verdict, correction, decided_at, verdict_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        params.runId,
        params.messageId,
        params.internetMessageId,
        JSON.stringify(params.features),
        params.ruleId,
        params.ruleRevision,
        params.category,
        JSON.stringify(params.proposedAction),
        params.confidence,
        params.rationale,
        JSON.stringify(params.alsoMatched ?? []),
        params.suggestedRule ? JSON.stringify(params.suggestedRule) : null,
        params.verdict ?? "pending",
        params.correction ? JSON.stringify(params.correction) : null,
        Date.now(),
        params.verdict && params.verdict !== "pending" ? Date.now() : null,
      );
    return Number(result.lastInsertRowid);
  }

  getDecision(id: number): DecisionRow | null {
    const row = this.db
      .prepare("SELECT * FROM decisions WHERE id = ?")
      .get(id) as RawDecisionRow | undefined;
    return row ? rowToDecision(row) : null;
  }

  /**
   * True when this message already received a real verdict. Pending and
   * skipped rows don't count — a skipped email should reappear next run.
   */
  hasDecidedMessage(internetMessageId: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM decisions WHERE internet_message_id = ? " +
          "AND verdict IN ('approved', 'rejected', 'corrected', 'auto') LIMIT 1",
      )
      .get(internetMessageId);
    return row !== undefined;
  }

  setVerdict(id: number, verdict: Verdict, correction?: Correction): void {
    this.db
      .prepare(
        "UPDATE decisions SET verdict = ?, correction = ?, verdict_at = ? WHERE id = ?",
      )
      .run(verdict, correction ? JSON.stringify(correction) : null, Date.now(), id);
  }

  markExecuted(id: number, error?: string): void {
    this.db
      .prepare("UPDATE decisions SET executed_at = ?, error = ? WHERE id = ?")
      .run(Date.now(), error ?? null, id);
  }

  /** Recent decisions, newest first (for `triage history`). */
  listDecisions(params?: { limit?: number }): DecisionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM decisions ORDER BY id DESC LIMIT ?")
      .all(params?.limit ?? 20) as RawDecisionRow[];
    return rows.map(rowToDecision);
  }

  // -------------------------------------------------------------------------
  // Learning-loop queries
  // -------------------------------------------------------------------------

  /**
   * Rejected/corrected decisions (plus no-rule records carrying a
   * suggestedRule) that refine has not yet distilled, above the watermark.
   */
  undistilledSignals(): DecisionRow[] {
    const watermark = Number(this.getMeta("refine_watermark") ?? "0");
    const rows = this.db
      .prepare(
        "SELECT * FROM decisions WHERE id > ? AND distilled_at IS NULL AND (" +
          "verdict IN ('rejected', 'corrected') " +
          "OR (suggested_rule IS NOT NULL AND verdict != 'pending')" +
          ") ORDER BY id ASC",
      )
      .all(watermark) as RawDecisionRow[];
    return rows.map(rowToDecision);
  }

  countUndistilledSignals(): number {
    return this.undistilledSignals().length;
  }

  markDistilled(ids: number[]): void {
    const stmt = this.db.prepare(
      "UPDATE decisions SET distilled_at = ? WHERE id = ?",
    );
    const tx = this.db.transaction(() => {
      const now = Date.now();
      for (const id of ids) stmt.run(now, id);
    });
    tx();
  }

  ruleAccuracy(): RuleAccuracyRow[] {
    const rows = this.db
      .prepare("SELECT * FROM rule_accuracy")
      .all() as Array<{
      rule_id: string;
      fired: number;
      approved: number;
      rejected: number;
      corrected: number;
      auto: number;
      last_decided_at: number | null;
    }>;
    return rows.map((r) => ({
      ruleId: r.rule_id,
      fired: r.fired,
      approved: r.approved,
      rejected: r.rejected,
      corrected: r.corrected,
      auto: r.auto,
      lastDecidedAt: r.last_decided_at,
    }));
  }

  /** Last N verdicts for a rule, newest first (promotion criteria). */
  lastVerdictsForRule(ruleId: string, limit: number): Verdict[] {
    const rows = this.db
      .prepare(
        "SELECT verdict FROM decisions WHERE rule_id = ? " +
          "AND verdict NOT IN ('pending', 'skipped') ORDER BY id DESC LIMIT ?",
      )
      .all(ruleId, limit) as Array<{ verdict: Verdict }>;
    return rows.map((r) => r.verdict);
  }

  // -------------------------------------------------------------------------
  // Rule events (audit trail)
  // -------------------------------------------------------------------------

  insertRuleEvent(event: RuleEvent): void {
    this.db
      .prepare(
        "INSERT INTO rule_events (rule_id, revision, event, actor, old_body, new_body, evidence, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.ruleId,
        event.revision,
        event.event,
        event.actor,
        event.oldBody ?? null,
        event.newBody ?? null,
        event.evidence !== undefined ? JSON.stringify(event.evidence) : null,
        Date.now(),
      );
  }

  listRuleEvents(ruleId: string): Array<RuleEvent & { createdAt: number }> {
    const rows = this.db
      .prepare(
        "SELECT rule_id, revision, event, actor, old_body, new_body, evidence, created_at " +
          "FROM rule_events WHERE rule_id = ? ORDER BY id ASC",
      )
      .all(ruleId) as Array<{
      rule_id: string;
      revision: number;
      event: RuleEvent["event"];
      actor: RuleEvent["actor"];
      old_body: string | null;
      new_body: string | null;
      evidence: string | null;
      created_at: number;
    }>;
    return rows.map((r) => ({
      ruleId: r.rule_id,
      revision: r.revision,
      event: r.event,
      actor: r.actor,
      oldBody: r.old_body ?? undefined,
      newBody: r.new_body ?? undefined,
      evidence: r.evidence ? JSON.parse(r.evidence) : undefined,
      createdAt: r.created_at,
    }));
  }

  // -------------------------------------------------------------------------
  // Meta + retention
  // -------------------------------------------------------------------------

  getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = ?",
      )
      .run(key, value, value);
  }

  /**
   * Prune decisions older than retentionDays — except rows cited as
   * evidence in rule_events, which stay for the audit trail.
   */
  pruneOldDecisions(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cited = new Set<number>();
    const events = this.db
      .prepare("SELECT evidence FROM rule_events WHERE evidence IS NOT NULL")
      .all() as Array<{ evidence: string }>;
    for (const e of events) {
      try {
        const parsed = JSON.parse(e.evidence);
        if (Array.isArray(parsed)) {
          for (const v of parsed) {
            if (typeof v === "number") cited.add(v);
          }
        }
      } catch {
        // malformed evidence never blocks pruning of other rows
      }
    }

    const oldRows = this.db
      .prepare("SELECT id FROM decisions WHERE decided_at < ?")
      .all(cutoff) as Array<{ id: number }>;
    const toDelete = oldRows.map((r) => r.id).filter((id) => !cited.has(id));

    const stmt = this.db.prepare("DELETE FROM decisions WHERE id = ?");
    const tx = this.db.transaction(() => {
      for (const id of toDelete) stmt.run(id);
    });
    tx();
    return toDelete.length;
  }

  close(): void {
    this.db.close();
  }
}
