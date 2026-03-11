import * as readline from "node:readline";
import { saveConfig } from "../config/config.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { CONFIG_PATH } from "../config/paths.js";
import { prompt, select, multiSelect, confirm } from "./prompt-helpers.js";
import type { PromptOption } from "./prompt-helpers.js";
import type { OpenClippyConfig } from "../config/types.base.js";
import type { ServicesConfig } from "../config/types.services.js";

/** Metadata for each M365 service available in the wizard. */
const SERVICE_OPTIONS: PromptOption[] = [
  { label: "Mail (Outlook)", value: "mail", description: "Read, send, search emails", selected: true },
  { label: "Calendar", value: "calendar", description: "Events, meetings, free/busy", selected: true },
  { label: "ToDo", value: "todo", description: "Task lists and tasks", selected: true },
  { label: "Teams Chat", value: "teams-chat", description: "Chat messages and channels", selected: true },
  { label: "OneDrive", value: "onedrive", description: "Files and folders", selected: false },
  { label: "Planner", value: "planner", description: "Plans, tasks, and buckets", selected: false },
  { label: "OneNote", value: "onenote", description: "Notebooks, sections, pages", selected: false },
  { label: "SharePoint", value: "sharepoint", description: "Sites, lists, document libraries", selected: false },
  { label: "People", value: "people", description: "Contacts and people search", selected: true },
  { label: "Presence", value: "presence", description: "Online status", selected: true },
];

/** All known service IDs (matches SERVICE_OPTIONS order). */
const ALL_SERVICE_IDS = SERVICE_OPTIONS.map((o) => o.value);

/** Tool profile options for the wizard. */
const PROFILE_OPTIONS: PromptOption[] = [
  { label: "read-only", value: "read-only", description: "List, read, search only" },
  { label: "standard", value: "standard", description: "Read + create, update, draft" },
  { label: "full", value: "full", description: "Standard + send, delete, share" },
  { label: "admin", value: "admin", description: "Full + org-wide operations" },
];

/**
 * Run the interactive setup wizard.
 *
 * Accepts optional overrides for the readline interface and config file path
 * (used by tests). When not provided, creates a real stdin/stdout rl and
 * writes to the default CONFIG_PATH.
 */
export async function runSetupWizard(options?: {
  rl?: readline.Interface;
  configPath?: string;
}): Promise<void> {
  const ownRl = !options?.rl;
  const rl =
    options?.rl ??
    readline.createInterface({ input: process.stdin, output: process.stdout });
  const configPath = options?.configPath ?? CONFIG_PATH;

  try {
    await runWizardSteps(rl, configPath);
  } finally {
    if (ownRl) {
      rl.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Internal wizard flow
// ---------------------------------------------------------------------------

async function runWizardSteps(
  rl: readline.Interface,
  configPath: string,
): Promise<void> {
  // Step 1: Welcome banner
  printBanner(rl);

  // Step 2: Azure client ID
  const clientId = await prompt(
    rl,
    "Azure AD Client ID:",
    DEFAULT_CONFIG.azure!.clientId,
  );

  // Step 3: Azure tenant ID
  const tenantId = await prompt(
    rl,
    "Azure AD Tenant ID:",
    DEFAULT_CONFIG.azure!.tenantId,
  );

  // Step 4: Anthropic API key (required, re-prompt if empty)
  let apiKey = "";
  while (!apiKey) {
    apiKey = await prompt(rl, "Anthropic API key:");
    if (!apiKey) {
      rl.output?.write("API key is required.\n");
    }
  }

  // Step 5: Services
  const selectedServices = await multiSelect(
    rl,
    "Enable M365 services:",
    SERVICE_OPTIONS,
  );

  // Step 6: Tool profile
  const toolProfile = await select(rl, "Tool profile:", PROFILE_OPTIONS);

  // Step 7: Agent name
  const agentName = await prompt(rl, "Agent name:", "Clippy");

  // Step 8: Agent emoji
  const agentEmoji = await prompt(rl, "Agent emoji:", "\u{1F4CE}");

  // Step 9: Gateway port
  const gatewayPortStr = await prompt(rl, "Gateway port:", "4100");
  const gatewayPort = parseInt(gatewayPortStr, 10) || 4100;

  // Step 10: Review
  printReview(rl, {
    clientId,
    tenantId,
    apiKey,
    selectedServices,
    toolProfile,
    agentName,
    agentEmoji,
    gatewayPort,
  });

  // Step 11: Save confirmation
  const shouldSave = await confirm(rl, "Save this configuration?");

  if (!shouldSave) {
    rl.output?.write("Setup cancelled. No changes were saved.\n");
    return;
  }

  // Build minimal config (only non-default values)
  const config = buildMinimalConfig({
    clientId,
    tenantId,
    apiKey,
    selectedServices,
    toolProfile,
    agentName,
    agentEmoji,
    gatewayPort,
  });

  await saveConfig(config, configPath);
  rl.output?.write("Configuration saved successfully!\n");
}

// ---------------------------------------------------------------------------
// Banner + review printing
// ---------------------------------------------------------------------------

function printBanner(rl: readline.Interface): void {
  rl.output?.write("\n");
  rl.output?.write("  \u{1F4CE} OpenClippy Setup Wizard\n");
  rl.output?.write("  ========================\n");
  rl.output?.write("  Configure your autonomous AI work agent for Microsoft 365.\n");
  rl.output?.write("\n");
}

type WizardAnswers = {
  clientId: string;
  tenantId: string;
  apiKey: string;
  selectedServices: string[];
  toolProfile: string;
  agentName: string;
  agentEmoji: string;
  gatewayPort: number;
};

function printReview(rl: readline.Interface, answers: WizardAnswers): void {
  rl.output?.write("\n--- Configuration Review ---\n");
  rl.output?.write(`  Azure Client ID : ${answers.clientId}\n`);
  rl.output?.write(`  Azure Tenant ID : ${answers.tenantId}\n`);
  rl.output?.write(`  API Key         : ${answers.apiKey.length > 8 ? "***" + answers.apiKey.slice(-4) : "****"}\n`);
  rl.output?.write(`  Services        : ${answers.selectedServices.join(", ")}\n`);
  rl.output?.write(`  Tool Profile    : ${answers.toolProfile}\n`);
  rl.output?.write(`  Agent Name      : ${answers.agentName}\n`);
  rl.output?.write(`  Agent Emoji     : ${answers.agentEmoji}\n`);
  rl.output?.write(`  Gateway Port    : ${answers.gatewayPort}\n`);
  rl.output?.write("----------------------------\n\n");
}

// ---------------------------------------------------------------------------
// Minimal config builder
// ---------------------------------------------------------------------------

/**
 * Build a config object containing only values that differ from defaults.
 * The apiKey is always included (it has no default).
 */
function buildMinimalConfig(answers: WizardAnswers): OpenClippyConfig {
  const config: OpenClippyConfig = {};
  const defaults = DEFAULT_CONFIG;

  // Azure — only include if different from defaults
  const azureDiffs: Record<string, string> = {};
  if (answers.clientId !== defaults.azure!.clientId) {
    azureDiffs.clientId = answers.clientId;
  }
  if (answers.tenantId !== defaults.azure!.tenantId) {
    azureDiffs.tenantId = answers.tenantId;
  }
  if (Object.keys(azureDiffs).length > 0) {
    config.azure = azureDiffs;
  }

  // Services — only include if selection differs from defaults
  const servicesConfig = buildServicesConfig(answers.selectedServices);
  if (servicesConfig) {
    config.services = servicesConfig;
  }

  // Agent — always include apiKey; include identity/toolProfile only if non-default
  const agentDiffs: Record<string, unknown> = {};
  if (answers.apiKey) {
    agentDiffs.apiKey = answers.apiKey;
  }
  if (answers.toolProfile !== defaults.agent!.toolProfile) {
    agentDiffs.toolProfile = answers.toolProfile;
  }
  const identityDiffs: Record<string, string> = {};
  if (answers.agentName !== defaults.agent!.identity!.name) {
    identityDiffs.name = answers.agentName;
  }
  if (answers.agentEmoji !== defaults.agent!.identity!.emoji) {
    identityDiffs.emoji = answers.agentEmoji;
  }
  if (Object.keys(identityDiffs).length > 0) {
    agentDiffs.identity = identityDiffs;
  }
  if (Object.keys(agentDiffs).length > 0) {
    config.agent = agentDiffs;
  }

  // Gateway — only include if port differs from default
  if (answers.gatewayPort !== defaults.gateway!.port) {
    config.gateway = { port: answers.gatewayPort };
  }

  return config;
}

/**
 * Compare the selected services against defaults.
 * Returns undefined if selections match defaults exactly.
 */
function buildServicesConfig(selectedServices: string[]): ServicesConfig | undefined {
  const defaults = DEFAULT_CONFIG.services!;
  const selectedSet = new Set(selectedServices);
  let hasDiff = false;

  const config: ServicesConfig = {};

  for (const serviceId of ALL_SERVICE_IDS) {
    const isSelected = selectedSet.has(serviceId);
    const defaultEnabled = defaults[serviceId as keyof typeof defaults]?.enabled ?? false;

    if (isSelected !== defaultEnabled) {
      hasDiff = true;
    }

    config[serviceId as keyof ServicesConfig] = { enabled: isSelected };
  }

  return hasDiff ? config : undefined;
}
