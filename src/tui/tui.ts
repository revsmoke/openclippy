import * as readline from "node:readline";
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
import type { AgentTool, ToolContext } from "../services/types.js";
import type { ModelConfig } from "../agents/model-config.js";

// All service module imports
import { mailModule } from "../services/mail/module.js";
import { calendarModule } from "../services/calendar/module.js";
import { todoModule } from "../services/todo/module.js";
import { teamsChatModule } from "../services/teams-chat/module.js";
import { onedriveModule } from "../services/onedrive/module.js";
import { peopleModule } from "../services/people/module.js";
import { presenceModule } from "../services/presence/module.js";
import { plannerModule } from "../services/planner/module.js";
import { onenoteModule } from "../services/onenote/module.js";
import { sharepointModule } from "../services/sharepoint/module.js";

export type SlashCommandDef = {
  name: string;
  description: string;
  aliases?: string[];
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show available commands" },
  { name: "reset", description: "Clear conversation history and start fresh" },
  { name: "status", description: "Show authentication and service status" },
  { name: "services", description: "List enabled services and their capabilities" },
  { name: "model", description: "Show or change the LLM model (e.g., /model claude-sonnet-4-5-20250514)" },
  { name: "quit", description: "Exit the TUI", aliases: ["exit", "q"] },
];

export type ParsedCommand = {
  command: string;
  args: string;
};

export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const name = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1);
  const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

  // Check if command exists (including aliases)
  const found = SLASH_COMMANDS.find(
    (cmd) => cmd.name === name || cmd.aliases?.includes(name),
  );

  if (found) {
    return { command: found.name, args };
  }

  return { command: "unknown", args: trimmed };
}

export function formatResponse(
  response: string,
  identity: { name: string; emoji: string },
): string {
  return `\n${identity.emoji} ${response}\n`;
}

function getEnabledServiceIds(config: { services?: Record<string, { enabled?: boolean }> }): ServiceId[] {
  const services = config.services ?? {};
  return Object.entries(services)
    .filter(([, svc]) => svc?.enabled)
    .map(([id]) => id as ServiceId);
}

/**
 * Start the interactive TUI chat.
 *
 * This is the main entry point -- it sets up authentication,
 * creates the agent, and runs the REPL loop.
 */
export async function startTui(): Promise<void> {
  // 1. Load config
  const config = await loadConfig();
  const identity = config.agent?.identity ?? { name: "Clippy", emoji: "📎" };

  console.log(`\n${identity.emoji} ${identity.name} — Interactive Mode`);
  console.log("Type a message to chat, or /help for commands.\n");

  // 2. Auth check
  const creds = resolveAzureCredentials(config);
  const client = new MSALClient({
    clientId: creds.clientId,
    tenantId: creds.tenantId,
  });

  const authenticated = await client.isAuthenticated();
  if (!authenticated) {
    console.error("Not authenticated. Run \"openclippy login\" first.");
    process.exitCode = 1;
    return;
  }

  // 3. Get token
  const scopeManager = new ScopeManager();
  const enabledServices = getEnabledServiceIds(config);
  const scopes = scopeManager.computeRequiredScopes(enabledServices);
  const tokenResult = await client.acquireToken(scopes);

  // 4. Build service registry
  const registry = new ServiceRegistry();
  registry.register(mailModule);
  registry.register(calendarModule);
  registry.register(todoModule);
  registry.register(teamsChatModule);
  registry.register(onedriveModule);
  registry.register(peopleModule);
  registry.register(presenceModule);
  registry.register(plannerModule);
  registry.register(onenoteModule);
  registry.register(sharepointModule);

  const servicesConfig = config.services ?? {};
  const profile = (config.tools?.profile ?? "standard") as ToolProfileId;
  const tools = collectTools({ registry, servicesConfig, profile });

  // 5. Build system prompt
  const enabledModules = registry.getEnabled(servicesConfig);
  const systemPrompt = buildSystemPrompt({
    identity,
    services: enabledModules,
    userInfo: {
      displayName: tokenResult.account?.name ?? undefined,
      email: tokenResult.account?.username ?? undefined,
    },
  });

  // 6. Resolve model config
  let modelConfig = resolveModelConfig(config.agent ?? {});

  // 7. Context for tool execution
  const toolContext: ToolContext = {
    token: tokenResult.accessToken,
    userId: tokenResult.account?.localAccountId ?? undefined,
  };

  // 8. Session and REPL
  let session = new AgentSession();

  console.log(`Authenticated as ${tokenResult.account?.name ?? "unknown"}`);
  console.log(`Model: ${modelConfig.model}`);
  console.log(`${enabledModules.length} services enabled, ${tools.length} tools available\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "You: ",
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Check for slash commands
    const cmd = parseSlashCommand(input);
    if (cmd) {
      switch (cmd.command) {
        case "help":
          console.log("\nAvailable commands:");
          for (const c of SLASH_COMMANDS) {
            const aliases = c.aliases ? ` (${c.aliases.map((a) => `/${a}`).join(", ")})` : "";
            console.log(`  /${c.name}${aliases} — ${c.description}`);
          }
          console.log("");
          break;

        case "reset":
          session = new AgentSession();
          console.log("\nConversation reset.\n");
          break;

        case "status":
          console.log(`\nAuthenticated as ${tokenResult.account?.name ?? "unknown"}`);
          console.log(`Model: ${modelConfig.model}`);
          console.log(`Session: ${session.id} (${session.messages.length} messages)\n`);
          break;

        case "services":
          console.log("\nEnabled services:");
          for (const mod of enabledModules) {
            const caps = Object.entries(mod.capabilities)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(", ");
            console.log(`  ${mod.meta.label}: ${caps}`);
          }
          console.log(`\n${tools.length} tools available in "${profile}" profile.\n`);
          break;

        case "model":
          if (cmd.args) {
            modelConfig = { ...modelConfig, model: cmd.args };
            console.log(`\nModel changed to: ${cmd.args}\n`);
          } else {
            console.log(`\nCurrent model: ${modelConfig.model}\n`);
          }
          break;

        case "quit":
          console.log(`\n${identity.emoji} Goodbye!\n`);
          rl.close();
          return;

        case "unknown":
          console.log(`\nUnknown command: ${cmd.args}. Type /help for available commands.\n`);
          break;
      }

      rl.prompt();
      return;
    }

    // Regular message -- send to agent
    try {
      console.log(""); // blank line before tool calls
      const response = await runAgent({
        message: input,
        session,
        modelConfig,
        tools,
        systemPrompt,
        toolContext,
        onToolCall: (name) => {
          console.log(`  Using tool: ${name}`);
        },
      });

      console.log(formatResponse(response, identity));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n${message}\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
