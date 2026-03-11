import { loadConfig } from "../config/config.js";
import { resolveAzureCredentials } from "../auth/credentials.js";
import { MSALClient } from "../auth/msal-client.js";
import { ScopeManager } from "../auth/scope-manager.js";
import { ServiceRegistry } from "../services/registry.js";
import { resolveModelConfig } from "../agents/model-config.js";
import { collectTools } from "../agents/tool-registry.js";
import { buildSystemPrompt } from "../agents/prompt-builder.js";
import { AgentSession } from "../agents/session.js";
import { runAgent } from "../agents/runtime.js";
import { PluginRegistry } from "../plugins/registry.js";
import type { ServiceId } from "../config/types.services.js";
import type { ToolProfileId } from "../config/types.tools.js";

// Service module imports — Phase 1
import { mailModule } from "../services/mail/module.js";
import { calendarModule } from "../services/calendar/module.js";
import { todoModule } from "../services/todo/module.js";
import { teamsChatModule } from "../services/teams-chat/module.js";
// Service module imports — Phase 2
import { onedriveModule } from "../services/onedrive/module.js";
import { peopleModule } from "../services/people/module.js";
import { presenceModule } from "../services/presence/module.js";
// Service module imports — Phase 3
import { plannerModule } from "../services/planner/module.js";
import { onenoteModule } from "../services/onenote/module.js";
import { sharepointModule } from "../services/sharepoint/module.js";

/** Get the list of enabled service IDs from config */
function getEnabledServiceIds(config: { services?: Record<string, { enabled?: boolean }> }): ServiceId[] {
  const services = config.services ?? {};
  return Object.entries(services)
    .filter(([, svc]) => svc?.enabled)
    .map(([id]) => id as ServiceId);
}

export async function askCommand(message: string): Promise<void> {
  try {
    // 1. Load config
    const config = await loadConfig();

    // 2. Create MSALClient, check auth
    const creds = resolveAzureCredentials(config);
    const client = new MSALClient({
      clientId: creds.clientId,
      tenantId: creds.tenantId,
    });

    const authenticated = await client.isAuthenticated();
    if (!authenticated) {
      console.error("\u274C Not authenticated. Run \"openclippy login\" first.");
      process.exitCode = 1;
      return;
    }

    // Get token silently
    const scopeManager = new ScopeManager();
    const enabledServices = getEnabledServiceIds(config);
    const scopes = scopeManager.computeRequiredScopes(enabledServices);
    const tokenResult = await client.acquireToken(scopes);

    // 3. Build service registry, collect tools based on profile
    const registry = new ServiceRegistry();
    // Phase 1 services
    registry.register(mailModule);
    registry.register(calendarModule);
    registry.register(todoModule);
    registry.register(teamsChatModule);
    // Phase 2 services
    registry.register(onedriveModule);
    registry.register(peopleModule);
    registry.register(presenceModule);
    // Phase 3 services
    registry.register(plannerModule);
    registry.register(onenoteModule);
    registry.register(sharepointModule);

    // Load plugins
    // Note: Plugins load after token acquisition. Plugin scopes registered here
    // won't be in the current token. Users must re-authenticate after installing
    // plugins that need custom Graph scopes. Most plugins use existing scopes.
    const pluginRegistry = new PluginRegistry(registry, scopeManager);
    const pluginResults = await pluginRegistry.loadAll({
      pluginConfig: config.plugins,
    });
    if (pluginResults.errors.length > 0) {
      for (const err of pluginResults.errors) {
        console.warn(`\u26A0\uFE0F  Plugin load failed: ${err.pluginPath}: ${err.error}`);
      }
    }
    if (pluginResults.loaded.length > 0) {
      console.log(`\uD83D\uDCE6 Loaded ${pluginResults.loaded.length} plugin(s): ${pluginResults.loaded.map(p => p.manifest.name).join(", ")}`);
    }

    const servicesConfig = config.services ?? {};
    const profile = (config.tools?.profile ?? "standard") as ToolProfileId;
    const tools = collectTools({
      registry,
      servicesConfig,
      profile,
    });

    // 4. Build system prompt
    const enabledModules = registry.getEnabled(servicesConfig);
    const systemPrompt = buildSystemPrompt({
      identity: config.agent?.identity ?? { name: "Clippy", emoji: "\uD83D\uDCCE" },
      services: enabledModules,
      userInfo: {
        displayName: tokenResult.account?.name ?? undefined,
        email: tokenResult.account?.username ?? undefined,
      },
    });

    // 5. Resolve model config
    const modelConfig = resolveModelConfig(config.agent ?? {});

    // 6. Create agent session
    const session = new AgentSession();

    // 7. Run agent with the message
    const response = await runAgent({
      message,
      session,
      modelConfig,
      tools,
      systemPrompt,
      toolContext: {
        token: tokenResult.accessToken,
        userId: tokenResult.account?.localAccountId ?? undefined,
      },
      onToolCall: (name) => {
        console.log(`  \uD83D\uDD27 Using tool: ${name}`);
      },
    });

    // 8. Print the response
    console.log(`\n\uD83D\uDCCE ${response}`);
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err);
    console.error(`\u274C ${message_}`);
    process.exitCode = 1;
  }
}
