/**
 * `openclippy triage` — classify inbox mail against the user's saved
 * rules, review the proposals, act on approval, and learn from
 * corrections.
 *
 * Subcommands: (default run), refine, rules, history, init.
 *
 * This file is thin glue: config + auth + wiring. The testable logic
 * lives in src/triage/*.
 */
import * as readline from "node:readline";
import { loadConfig } from "../config/config.js";
import { TRIAGE_DB_PATH, TRIAGE_RULES_PATH } from "../config/paths.js";
import { getErrorMessage } from "../services/tool-utils.js";
import { resolveAzureCredentials } from "../auth/credentials.js";
import { MSALClient } from "../auth/msal-client.js";
import { ScopeManager } from "../auth/scope-manager.js";
import { resolveModelConfig } from "../agents/model-config.js";
import { getEnabledServiceIds } from "../config/helpers.js";
import type { ModelConfig } from "../agents/model-config.js";
import type { IdentityConfig } from "../config/types.agent.js";
import type { OpenClippyConfig } from "../config/types.base.js";
import { ensureRulesFile, loadRules } from "../triage/rules-file.js";
import { TriageStore } from "../triage/store.js";
import { runTriage } from "../triage/run.js";
import type { ResolvedTriageConfig, TriageRunOptions } from "../triage/run.js";
import { runRefine } from "../triage/refine.js";
import { runInit } from "../triage/init.js";
import { describeAction } from "../triage/rule-types.js";

type Bootstrap = {
  config: OpenClippyConfig;
  token: string;
  modelConfig: ModelConfig;
  identity: IdentityConfig;
  triage: ResolvedTriageConfig;
  rulesPath: string;
};

export function resolveTriageConfig(
  config: OpenClippyConfig,
): ResolvedTriageConfig {
  const t = config.triage ?? {};
  return {
    defaultLimit: t.defaultLimit ?? 25,
    chunkSize: t.chunkSize ?? 15,
    autoAct: t.autoAct ?? false,
    improveAfterCorrections: t.improveAfterCorrections ?? 3,
    retentionDays: t.retentionDays ?? 180,
    maxRules: t.maxRules ?? 50,
    snippetChars: t.snippetChars ?? 300,
    rulesPath: t.rulesPath,
    defaultForwardTarget: t.defaultForwardTarget,
  };
}

async function bootstrap(): Promise<Bootstrap | null> {
  const config = await loadConfig();

  const creds = resolveAzureCredentials(config);
  const client = new MSALClient({
    clientId: creds.clientId,
    tenantId: creds.tenantId,
  });

  const authenticated = await client.isAuthenticated();
  if (!authenticated) {
    console.error('❌ Not authenticated. Run "openclippy login" first.');
    process.exitCode = 1;
    return null;
  }

  const scopeManager = new ScopeManager();
  const scopes = scopeManager.computeRequiredScopes(
    getEnabledServiceIds(config),
  );
  const tokenResult = await client.acquireToken(scopes);

  const triage = resolveTriageConfig(config);
  return {
    config,
    token: tokenResult.accessToken,
    modelConfig: resolveModelConfig(config.agent ?? {}),
    identity: config.agent?.identity ?? { name: "Clippy", emoji: "📎" },
    triage,
    rulesPath: triage.rulesPath ?? TRIAGE_RULES_PATH,
  };
}

function makeRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function triageCommand(opts: {
  limit?: string;
  folder?: string;
  all?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  try {
    const boot = await bootstrap();
    if (!boot) return;

    const seeded = await ensureRulesFile(boot.rulesPath);
    if (seeded) {
      console.log(
        `📝 Created starter rules file at ${boot.rulesPath} — edit it or run "openclippy triage init".`,
      );
    }
    const loaded = await loadRules(boot.rulesPath);

    const store = new TriageStore(TRIAGE_DB_PATH);
    const rl = makeRl();
    try {
      store.pruneOldDecisions(boot.triage.retentionDays);

      const options: TriageRunOptions = {
        limit: opts.limit ? Number(opts.limit) : undefined,
        folder: opts.folder,
        all: opts.all,
        dryRun: opts.dryRun,
      };
      await runTriage({
        token: boot.token,
        modelConfig: boot.modelConfig,
        identity: boot.identity,
        triage: boot.triage,
        loaded,
        store,
        rl,
        out: (line) => console.log(line),
        options,
      });
    } finally {
      rl.close();
      store.close();
    }
  } catch (err) {
    console.error(`❌ ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

export async function triageRefineCommand(): Promise<void> {
  try {
    const boot = await bootstrap();
    if (!boot) return;

    await ensureRulesFile(boot.rulesPath);
    const loaded = await loadRules(boot.rulesPath);

    const store = new TriageStore(TRIAGE_DB_PATH);
    const rl = makeRl();
    try {
      const summary = await runRefine({
        store,
        loaded,
        modelConfig: boot.modelConfig,
        identity: boot.identity,
        rl,
        out: (line) => console.log(line),
      });
      console.log(
        `\nRefine done: ${summary.signals} signal(s) considered, ` +
          `${summary.applied}/${summary.proposals} rule change(s) applied, ` +
          `${summary.lifecycleApplied} lifecycle change(s).`,
      );
    } finally {
      rl.close();
      store.close();
    }
  } catch (err) {
    console.error(`❌ ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

export async function triageRulesCommand(): Promise<void> {
  try {
    const config = await loadConfig();
    const triage = resolveTriageConfig(config);
    const rulesPath = triage.rulesPath ?? TRIAGE_RULES_PATH;
    await ensureRulesFile(rulesPath);
    const loaded = await loadRules(rulesPath);

    if (loaded.file.rules.length === 0) {
      console.log("No triage rules defined. Run \"openclippy triage init\".");
      return;
    }

    const store = new TriageStore(TRIAGE_DB_PATH);
    try {
      const accuracy = new Map(store.ruleAccuracy().map((r) => [r.ruleId, r]));
      console.log(`Triage rules (${loaded.file.rules.length}) — ${rulesPath}\n`);
      for (const rule of [...loaded.file.rules].sort(
        (a, b) => a.priority - b.priority,
      )) {
        const acc = accuracy.get(rule.id);
        const stats = acc
          ? `fired ${acc.fired}× | ${acc.approved + acc.auto} ok, ${acc.rejected} rejected, ${acc.corrected} corrected`
          : "never fired";
        console.log(
          `${rule.id} [${rule.state}] p${rule.priority} rev${rule.revision} — ${describeAction(rule.action)}`,
        );
        console.log(`  ${rule.match.trim().replace(/\n/g, "\n  ")}`);
        console.log(`  ${stats}\n`);
      }
    } finally {
      store.close();
    }
  } catch (err) {
    console.error(`❌ ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

export async function triageHistoryCommand(opts: {
  limit?: string;
}): Promise<void> {
  try {
    const store = new TriageStore(TRIAGE_DB_PATH);
    try {
      const rows = store.listDecisions({
        limit: opts.limit ? Number(opts.limit) : 20,
      });
      if (rows.length === 0) {
        console.log("No triage decisions yet.");
        return;
      }
      for (const d of rows) {
        const when = new Date(d.decidedAt).toISOString().slice(0, 16);
        const outcome =
          d.verdict === "corrected" && d.correction
            ? `corrected → ${describeAction(d.correction.action)}`
            : d.verdict;
        console.log(
          `#${d.id} ${when} ${d.features.from} — "${d.features.subject}"` +
            `\n    proposed ${describeAction(d.proposedAction)} (${d.ruleId ?? "no rule"}, ${d.confidence}) → ${outcome}` +
            (d.error ? ` [ERROR: ${d.error}]` : ""),
        );
      }
    } finally {
      store.close();
    }
  } catch (err) {
    console.error(`❌ ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

export async function triageInitCommand(): Promise<void> {
  try {
    const boot = await bootstrap();
    if (!boot) return;

    await ensureRulesFile(boot.rulesPath);
    const loaded = await loadRules(boot.rulesPath);

    const store = new TriageStore(TRIAGE_DB_PATH);
    const rl = makeRl();
    try {
      await runInit({
        token: boot.token,
        modelConfig: boot.modelConfig,
        identity: boot.identity,
        loaded,
        store,
        rl,
        out: (line) => console.log(line),
      });
    } finally {
      rl.close();
      store.close();
    }
  } catch (err) {
    console.error(`❌ ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}
