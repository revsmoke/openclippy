import { loadConfig } from "../config/config.js";
import { getErrorMessage } from "../services/tool-utils.js";
import { ScopeManager } from "../auth/scope-manager.js";
import { BUILTIN_SERVICE_IDS } from "../config/types.services.js";

export async function servicesCommand(): Promise<void> {
  try {
    // 1. Load config
    const config = await loadConfig();

    // 2. Create scope manager
    const scopeManager = new ScopeManager();

    console.log("Microsoft 365 Services");
    console.log("======================\n");

    // 3. List all services with enabled/disabled status
    for (const svcId of BUILTIN_SERVICE_IDS) {
      const svcConfig = config.services?.[svcId];
      const enabled = svcConfig?.enabled ?? false;
      const icon = enabled ? "\u2705" : "\u2B1C";

      console.log(`${icon} ${svcId}${enabled ? " (enabled)" : " (disabled)"}`);

      // 4. Show required scopes per service
      if (enabled) {
        const requiredScopes = scopeManager.computeRequiredScopes([svcId]);
        // Filter out base scopes to show only service-specific ones
        const baseScopes = scopeManager.getBaseScopes();
        const serviceScopes = requiredScopes.filter((s) => !baseScopes.includes(s));
        if (serviceScopes.length > 0) {
          console.log(`     Scopes: ${serviceScopes.join(", ")}`);
        }
      }
    }

    // Summary
    const enabledCount = BUILTIN_SERVICE_IDS.filter(
      (id) => config.services?.[id]?.enabled
    ).length;
    console.log(`\n${enabledCount} of ${BUILTIN_SERVICE_IDS.length} services enabled.`);
  } catch (err) {
    console.error(`\u274C Failed to list services: ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}
