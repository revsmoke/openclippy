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
import type { ServiceId } from "../config/types.services.js";
import type { ToolProfileId } from "../config/types.tools.js";

// Service module imports
import { mailModule } from "../services/mail/module.js";
import { calendarModule } from "../services/calendar/module.js";
import { todoModule } from "../services/todo/module.js";
import { teamsChatModule } from "../services/teams-chat/module.js";

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
    registry.register(mailModule);
    registry.register(calendarModule);
    registry.register(todoModule);
    registry.register(teamsChatModule);

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
