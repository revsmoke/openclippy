import type { ServiceRegistry } from "../services/registry.js";
import type { ScopeManager } from "../auth/scope-manager.js";
import { getErrorMessage } from "../services/tool-utils.js";
import { scanPluginDirs } from "./scanner.js";
import { loadPlugin } from "./loader.js";
import type { PluginLoadResult, PluginError, PluginsConfig } from "./types.js";

/**
 * Orchestrates plugin discovery, loading, validation, and registration.
 *
 * Ties together:
 *   scanner  → finds plugin directories
 *   loader   → reads manifest + imports module
 *   ServiceRegistry → registers the service module
 *   ScopeManager    → registers plugin-specific scopes
 *
 * Never throws — all errors are collected and returned.
 */
export class PluginRegistry {
  private loaded: PluginLoadResult[] = [];
  private errors: PluginError[] = [];

  constructor(
    private serviceRegistry: ServiceRegistry,
    private scopeManager: ScopeManager,
  ) {}

  /**
   * Discover, load, and register all plugins.
   * Plugins that fail to load are skipped with errors collected.
   */
  async loadAll(options?: {
    pluginsDir?: string;
    pluginConfig?: PluginsConfig;
  }): Promise<{
    loaded: PluginLoadResult[];
    errors: PluginError[];
  }> {
    this.loaded = [];
    this.errors = [];

    // 1. Build configPaths from pluginConfig entries that have an explicit path
    const configPaths: Record<string, string> = {};
    if (options?.pluginConfig) {
      for (const [serviceId, cfg] of Object.entries(options.pluginConfig)) {
        if (cfg.path) {
          configPaths[serviceId] = cfg.path;
        }
      }
    }

    // 2. Scan for plugin directories
    const dirs = await scanPluginDirs({
      pluginsDir: options?.pluginsDir,
      configPaths,
    });

    // 3. Track serviceIds loaded in this batch for collision detection
    const loadedIds = new Set<string>();

    // 4. For each discovered directory, attempt load + registration
    for (const dir of dirs) {
      try {
        // a. Load plugin (reads manifest + imports module)
        const result = await loadPlugin(dir);
        const serviceId = result.manifest.serviceId;

        // b. Check for collision with already-registered builtins
        const existingIds = this.serviceRegistry.listRegistered();
        if (existingIds.includes(serviceId)) {
          this.errors.push({
            pluginPath: dir,
            error: `Service ID collision: "${serviceId}" is already registered (builtin or prior plugin)`,
          });
          continue;
        }

        // c. Check for collision with plugins loaded in this batch
        if (loadedIds.has(serviceId)) {
          this.errors.push({
            pluginPath: dir,
            error: `Service ID collision: "${serviceId}" is already registered by another plugin in this batch`,
          });
          continue;
        }

        // d. Register module in ServiceRegistry
        this.serviceRegistry.register(result.module);

        // e. Register scopes in ScopeManager (if manifest has scopes)
        if (result.manifest.scopes) {
          this.scopeManager.registerPluginScopes(serviceId, {
            required: result.manifest.scopes.required ?? [],
            optional: result.manifest.scopes.optional ?? [],
          });
        }

        // f. Track in loaded list and batch set
        this.loaded.push(result);
        loadedIds.add(serviceId);
      } catch (err: unknown) {
        this.errors.push({
          pluginPath: dir,
          error: getErrorMessage(err),
        });
      }
    }

    return { loaded: this.loaded, errors: this.errors };
  }

  /** Return a copy of all successfully loaded plugins */
  getLoadedPlugins(): PluginLoadResult[] {
    return [...this.loaded];
  }

  /** Return a copy of all errors encountered during loading */
  getLoadErrors(): PluginError[] {
    return [...this.errors];
  }
}
