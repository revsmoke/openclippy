import type { ServiceId, ServicesConfig } from "../config/types.services.js";
import type { AgentTool, ProbeResult, ServiceModule } from "./types.js";

/**
 * Central registry for M365 service modules.
 *
 * Services register themselves at startup; the agent then queries the
 * registry to discover enabled tools, run health probes, etc.
 */
export class ServiceRegistry {
  private modules = new Map<ServiceId, ServiceModule>();

  /** Register (or replace) a service module */
  register(module: ServiceModule): void {
    this.modules.set(module.id, module);
  }

  /** Retrieve a module by id, or undefined if not registered */
  get(id: ServiceId): ServiceModule | undefined {
    return this.modules.get(id);
  }

  /** Return modules whose service is enabled in config */
  getEnabled(config: ServicesConfig): ServiceModule[] {
    const enabled: ServiceModule[] = [];
    for (const [id, mod] of this.modules) {
      const svc = config[id];
      if (svc?.enabled) {
        enabled.push(mod);
      }
    }
    return enabled;
  }

  /** Collect all tools from enabled service modules */
  getAllTools(config: ServicesConfig): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const mod of this.getEnabled(config)) {
      tools.push(...mod.tools());
    }
    return tools;
  }

  /** List the ids of all registered modules */
  listRegistered(): ServiceId[] {
    return [...this.modules.keys()];
  }

  /**
   * Run health probes on all enabled services that expose a `status.probe`.
   *
   * Probe exceptions are caught and reported as `{ ok: false, error }`.
   * Services without a probe method are omitted from the result map.
   */
  async probeAll(params: {
    token: string;
    config: ServicesConfig;
  }): Promise<Map<ServiceId, ProbeResult>> {
    const results = new Map<ServiceId, ProbeResult>();
    const enabled = this.getEnabled(params.config);

    const pending = enabled
      .filter((mod) => mod.status?.probe)
      .map(async (mod) => {
        try {
          // Non-null assertion safe: we just filtered for it
          const result = await mod.status!.probe({ token: params.token });
          results.set(mod.id, result);
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : String(err);
          results.set(mod.id, { ok: false, error: message });
        }
      });

    await Promise.all(pending);
    return results;
  }
}
