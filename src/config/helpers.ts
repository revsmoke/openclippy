import type { ServiceId } from "./types.services.js";
import type { OpenClippyConfig } from "./types.base.js";
import type { ToolProfileId } from "./types.tools.js";

/** Get the list of enabled service IDs from config */
export function getEnabledServiceIds(config: { services?: Record<string, { enabled?: boolean }> }): ServiceId[] {
  const services = config.services ?? {};
  return Object.entries(services)
    .filter(([, svc]) => svc?.enabled)
    .map(([id]) => id as ServiceId);
}

/**
 * Resolve the effective tool profile from config.
 *
 * Precedence: an explicit `tools.profile` wins, then `agent.toolProfile`
 * (the field the setup wizard writes), then "standard". A single resolver
 * keeps every agent entry point (ask, chat/TUI, gateway) and the status
 * display in agreement — previously they read only `config.tools.profile`
 * and silently ignored the wizard-written `agent.toolProfile`.
 */
export function getToolProfile(config: OpenClippyConfig): ToolProfileId {
  return (config.tools?.profile ?? config.agent?.toolProfile ?? "standard") as ToolProfileId;
}
