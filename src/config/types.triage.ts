/** Configuration for the email triage feature (`openclippy triage`). */
export type TriageConfig = {
  /** Override the rules file location (default: ~/.openclippy/triage/rules.yaml) */
  rulesPath?: string;
  /** Default number of messages to fetch per run (default: 25) */
  defaultLimit?: number;
  /** Emails per classification agent run (default: 15) */
  chunkSize?: number;
  /** Allow trusted rules with high confidence to execute without approval (default: false) */
  autoAct?: boolean;
  /** Nudge the user to run `triage refine` after this many undistilled corrections (default: 3) */
  improveAfterCorrections?: number;
  /** Prune decision rows older than this many days (default: 180) */
  retentionDays?: number;
  /** Soft cap on rules rendered into the prompt (default: 50) */
  maxRules?: number;
  /** Max characters of email body preview stored per decision (default: 300) */
  snippetChars?: number;
  /** Default forward target (e.g. an M365 Group mailbox SMTP address) */
  defaultForwardTarget?: string;
};
