import type { OpenClippyConfig } from "./types.base.js";

/** Canonical default agent model — single source of truth (also used by
 *  resolveModelConfig's fallback). */
export const DEFAULT_MODEL = "claude-sonnet-5";

export const DEFAULT_CONFIG: OpenClippyConfig = {
  azure: {
    clientId: "bfe7dd6e-ed60-4bf4-8396-801a8eada469",
    tenantId: "ddd9f933-04a5-43f0-8673-5933da46cdcb",
  },
  services: {
    mail: { enabled: true },
    calendar: { enabled: true },
    todo: { enabled: true },
    "teams-chat": { enabled: true },
    onedrive: { enabled: false },
    planner: { enabled: false },
    onenote: { enabled: false },
    sharepoint: { enabled: false },
    people: { enabled: true },
    presence: { enabled: true },
  },
  agent: {
    model: DEFAULT_MODEL,
    toolProfile: "standard",
    identity: {
      name: "Clippy",
      emoji: "📎",
    },
  },
  // Note: no `profile` default here on purpose. The effective profile is
  // resolved by getToolProfile() as `tools.profile ?? agent.toolProfile ??
  // "standard"`, so leaving this unset lets a wizard-written agent.toolProfile
  // take effect instead of always being overridden by a "standard" default.
  tools: {
    allow: [],
    deny: [],
  },
  gateway: {
    port: 4100,
    host: "localhost",
  },
  plugins: {},
  triage: {
    defaultLimit: 25,
    chunkSize: 15,
    autoAct: false,
    improveAfterCorrections: 3,
    retentionDays: 180,
    maxRules: 50,
    snippetChars: 300,
  },
};
