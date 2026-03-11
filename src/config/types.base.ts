import type { AzureConfig } from "./types.azure.js";
import type { ServicesConfig } from "./types.services.js";
import type { AgentConfig } from "./types.agent.js";
import type { ToolsConfig } from "./types.tools.js";
import type { GatewayConfig } from "./types.gateway.js";
import type { PluginsConfig } from "../plugins/types.js";

export type OpenClippyConfig = {
  azure?: AzureConfig;
  services?: ServicesConfig;
  agent?: AgentConfig;
  tools?: ToolsConfig;
  gateway?: GatewayConfig;
  plugins?: PluginsConfig;
};
