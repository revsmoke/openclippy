import type { ServiceModule } from "../services/types.js";

/** Plugin manifest.json schema */
export type PluginManifest = {
  name: string;
  version: string;
  description: string;
  serviceId: string;
  entry: string;
  scopes?: {
    required?: string[];
    optional?: string[];
  };
};

/** Successful plugin load result */
export type PluginLoadResult = {
  manifest: PluginManifest;
  path: string;
  module: ServiceModule;
};

/** Plugin loading error */
export type PluginError = {
  pluginPath: string;
  error: string;
};

/** Plugin configuration in config.yaml */
export type PluginsConfig = Record<string, {
  enabled?: boolean;
  path?: string;
  [key: string]: unknown;
}>;
