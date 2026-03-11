import type { OpenClippyConfig } from "./types.base.js";

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
    model: "claude-sonnet-4-5-20250514",
    toolProfile: "standard",
    identity: {
      name: "Clippy",
      emoji: "📎",
    },
  },
  tools: {
    profile: "standard",
    allow: [],
    deny: [],
  },
  gateway: {
    port: 4100,
    host: "localhost",
  },
  plugins: {},
};
