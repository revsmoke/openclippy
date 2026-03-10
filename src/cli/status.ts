import { loadConfig } from "../config/config.js";
import { resolveAzureCredentials } from "../auth/credentials.js";
import { MSALClient } from "../auth/msal-client.js";
import { ScopeManager } from "../auth/scope-manager.js";
import type { ServiceId } from "../config/types.services.js";

/** Get the list of enabled service IDs from config */
function getEnabledServiceIds(config: { services?: Record<string, { enabled?: boolean }> }): ServiceId[] {
  const services = config.services ?? {};
  return Object.entries(services)
    .filter(([, svc]) => svc?.enabled)
    .map(([id]) => id as ServiceId);
}

export async function statusCommand(): Promise<void> {
  try {
    // 1. Load config
    const config = await loadConfig();

    // 2. Create MSALClient, check if authenticated
    const creds = resolveAzureCredentials(config);
    const client = new MSALClient({
      clientId: creds.clientId,
      tenantId: creds.tenantId,
    });

    const authenticated = await client.isAuthenticated();

    console.log("OpenClippy Status");
    console.log("=================\n");

    if (authenticated) {
      // 3. Show account info
      const account = await client.getAccount();
      console.log("\u2705 Authenticated");
      console.log(`   Account: ${account?.username ?? "unknown"}`);
      console.log(`   Tenant:  ${account?.tenantId ?? "unknown"}\n`);

      // 4. Show each enabled service and whether scopes are granted
      const scopeManager = new ScopeManager();
      const enabledServices = getEnabledServiceIds(config);

      console.log("Services:");
      for (const svcId of enabledServices) {
        const hasScopes = scopeManager.hasRequiredScopes(svcId);
        const icon = hasScopes ? "\u2705" : "\u26A0\uFE0F";
        console.log(`  ${icon} ${svcId}${hasScopes ? " (scopes granted)" : " (scopes not verified)"}`);
      }
    } else {
      // 5. Not authenticated
      console.log("\u274C Not authenticated");
      console.log('\nRun "openclippy login" to sign in with your Microsoft account.');
    }

    // Show agent config
    console.log(`\nAgent: ${config.agent?.model ?? "not configured"}`);
    console.log(`Tool Profile: ${config.tools?.profile ?? "standard"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\u274C Status check failed: ${message}`);
    process.exitCode = 1;
  }
}
