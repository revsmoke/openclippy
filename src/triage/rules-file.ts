/**
 * Load/save the triage rules YAML file.
 *
 * The rules file is the user's asset: human-readable, hand-editable,
 * diffable. Saves are atomic (tmp + rename) and guarded by a content
 * hash taken at load time — if the file changed on disk since we read
 * it (external edit), the save aborts instead of clobbering.
 */
import { readFile, writeFile, rename, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { rulesFileSchema } from "./rule-types.js";
import type { RulesFile, TriageRule } from "./rule-types.js";

export class ExternalEditError extends Error {
  constructor(path: string) {
    super(
      `Rules file ${path} changed on disk since it was loaded. ` +
        "Aborting save — re-run to pick up the external edits.",
    );
    this.name = "ExternalEditError";
  }
}

export class RulesValidationError extends Error {
  constructor(path: string, detail: string) {
    super(`Invalid rules file ${path}: ${detail}`);
    this.name = "RulesValidationError";
  }
}

export type LoadedRules = {
  path: string;
  file: RulesFile;
  /** sha256 of the raw file content at load time */
  sha256: string;
};

function hashContent(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex");
}

const STARTER_RULES = `# OpenClippy email triage rules
#
# This file is yours: edit it freely. Each rule has a natural-language
# "match" (evaluated by the AI) and a structured "action". Rules are
# evaluated top-to-bottom by priority (lower number wins).
#
# States: proposed (awaiting your approval) -> active (every action needs
# approval) -> trusted (may auto-act when triage.autoAct is enabled) ->
# retired.
#
# Action types:
#   { type: move, folder: "Vendors/Invoices" }
#   { type: forward, to: group@yourorg.com, alsoFlag: true }
#   { type: reply_draft, guidance: "Acknowledge and say I'll respond by EOD" }
#   { type: flag }
#   { type: prioritize, importance: high }
#   { type: categorize, categories: ["Finance"] }
#   { type: none }
version: 1
rules:
  - id: urgent-requests
    name: Urgent requests
    state: active
    priority: 10
    match: >
      Emails that are urgent or time-sensitive: explicit deadlines today or
      tomorrow, requests for same-day response or approval, or escalations.
      NOT newsletters or automated notifications that merely use urgent
      language for marketing.
    examples: []
    action: { type: flag }
    revision: 1
`;

/** Create the rules file with a starter template if it doesn't exist. */
export async function ensureRulesFile(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf-8");
    return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, STARTER_RULES, "utf-8");
  return true;
}

/** Load and validate the rules file. */
export async function loadRules(path: string): Promise<LoadedRules> {
  const raw = await readFile(path, "utf-8");

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new RulesValidationError(
      path,
      err instanceof Error ? err.message : String(err),
    );
  }

  const result = rulesFileSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new RulesValidationError(path, detail);
  }

  return { path, file: result.data, sha256: hashContent(raw) };
}

/**
 * Atomically save an updated rules file.
 *
 * Verifies the on-disk content still matches the hash captured at load
 * time; writes to a tmp file and renames over the original. Pass
 * `backup: true` to keep a `.bak` copy of the previous content (used by
 * refine). Returns the fresh LoadedRules so callers can keep mutating.
 */
export async function saveRules(
  loaded: LoadedRules,
  updated: RulesFile,
  opts?: { backup?: boolean },
): Promise<LoadedRules> {
  // Validate before touching disk — never persist an invalid file
  const result = rulesFileSchema.safeParse(updated);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new RulesValidationError(loaded.path, detail);
  }

  // External-edit guard
  let currentRaw: string | null = null;
  try {
    currentRaw = await readFile(loaded.path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (currentRaw !== null && hashContent(currentRaw) !== loaded.sha256) {
    throw new ExternalEditError(loaded.path);
  }

  if (opts?.backup && currentRaw !== null) {
    await copyFile(loaded.path, `${loaded.path}.bak`);
  }

  const yaml = stringifyYaml(result.data);
  const tmpPath = `${loaded.path}.tmp`;
  await mkdir(dirname(loaded.path), { recursive: true });
  await writeFile(tmpPath, yaml, "utf-8");
  await rename(tmpPath, loaded.path);

  return { path: loaded.path, file: result.data, sha256: hashContent(yaml) };
}

/** Rules that participate in classification, in priority order. */
export function evaluableRules(file: RulesFile): TriageRule[] {
  return file.rules
    .filter((r) => r.state === "active" || r.state === "trusted")
    .sort((a, b) => a.priority - b.priority);
}

/** Find a rule by id. */
export function findRule(
  file: RulesFile,
  ruleId: string,
): TriageRule | undefined {
  return file.rules.find((r) => r.id === ruleId);
}
