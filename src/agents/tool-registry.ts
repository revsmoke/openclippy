import type { ServicesConfig } from "../config/types.services.js";
import type { ToolProfileId } from "../config/types.tools.js";
import type { AgentTool } from "../services/types.js";
import type { ServiceRegistry } from "../services/registry.js";
import { filterToolsByProfile } from "./tool-profiles.js";

/**
 * Collect all tools from enabled services, filtered by the active tool profile.
 */
export function collectTools(params: {
  registry: ServiceRegistry;
  servicesConfig: ServicesConfig;
  profile: ToolProfileId;
}): AgentTool[] {
  const allTools = params.registry.getAllTools(params.servicesConfig);
  return filterToolsByProfile(allTools, params.profile);
}
