import { loadConfig } from "../config/config.js";
import { resolveAzureCredentials } from "../auth/credentials.js";
import { MSALClient } from "../auth/msal-client.js";
import { ScopeManager } from "../auth/scope-manager.js";
import { getEnabledServiceIds } from "../config/helpers.js";

export async function loginCommand(): Promise<void> {
  try {
    // 1. Load config
    const config = await loadConfig();

    // 2. Resolve Azure credentials
    const creds = resolveAzureCredentials(config);

    // 3. Create MSALClient
    const client = new MSALClient({
      clientId: creds.clientId,
      tenantId: creds.tenantId,
    });

    // 4. Compute scopes from enabled services
    const scopeManager = new ScopeManager();
    const enabledServices = getEnabledServiceIds(config);
    const scopes = scopeManager.computeRequiredScopes(enabledServices);

    console.log("Authenticating with Microsoft 365...");
    console.log(`Requesting scopes for ${enabledServices.length} enabled services.\n`);

    // 5. Call acquireToken — MSAL prints the device code message
    const result = await client.acquireToken(scopes);

    // 6. Record granted scopes
    if (result.scopes) {
      scopeManager.recordGrantedScopes(result.scopes);
    }

    // 7. Print success
    const username = result.account?.username ?? "unknown";
    console.log(`\u2705 Signed in as ${username}`);

    // 8. Print enabled services + scope status
    console.log("\nService status:");
    for (const svcId of enabledServices) {
      const hasScopes = scopeManager.hasRequiredScopes(svcId);
      const icon = hasScopes ? "\u2705" : "\u26A0\uFE0F";
      console.log(`  ${icon} ${svcId}${hasScopes ? "" : " (missing scopes)"}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\u274C Login failed: ${message}`);
    process.exitCode = 1;
  }
}
