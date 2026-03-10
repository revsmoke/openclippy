import type { IdentityConfig } from "../config/types.agent.js";
import type { ServiceModule } from "../services/types.js";

export type PromptParams = {
  identity: IdentityConfig;
  services: ServiceModule[];
  userInfo?: { displayName?: string; email?: string };
  timezone?: string;
  contextHints?: string[];
};

/**
 * Build the system prompt for the AI agent.
 *
 * Includes identity, available services, user context,
 * behavioural guidelines, and service-specific hints.
 */
export function buildSystemPrompt(params: PromptParams): string {
  const {
    identity,
    services,
    userInfo,
    timezone,
    contextHints,
  } = params;

  const name = identity.name || "Clippy";
  const emoji = identity.emoji || "📎";

  const sections: string[] = [];

  // --- Identity ---
  sections.push(
    `You are ${emoji} ${name}, an AI assistant for Microsoft 365.`,
  );

  // --- Available services ---
  if (services.length > 0) {
    const serviceLines = services.map(
      (s) => `- ${s.meta.label}: ${s.meta.description}`,
    );
    sections.push(
      `You have access to the following M365 services:\n${serviceLines.join("\n")}`,
    );
  }

  // --- User context ---
  const contextParts: string[] = [];
  if (userInfo?.displayName) {
    contextParts.push(`User: ${userInfo.displayName}`);
  }
  if (userInfo?.email) {
    contextParts.push(`Email: ${userInfo.email}`);
  }
  if (timezone) {
    contextParts.push(`Timezone: ${timezone}`);
  }
  // Always include current time for temporal awareness
  contextParts.push(`Current time: ${new Date().toISOString()}`);

  if (contextParts.length > 0) {
    sections.push(`User context:\n${contextParts.join("\n")}`);
  }

  // --- Guidelines ---
  sections.push(
    [
      "Guidelines:",
      "- Always confirm with the user before sending emails or messages.",
      "- Always confirm before deleting anything.",
      "- For meetings, check free/busy availability before scheduling.",
      "- Summarize long email threads rather than dumping raw content.",
      "- Use the user's timezone for all date/time displays.",
      "- Be concise and helpful.",
    ].join("\n"),
  );

  // --- Service-specific prompt hints ---
  const allHints: string[] = [];

  // From services that provide promptHints()
  for (const svc of services) {
    if (svc.promptHints) {
      allHints.push(...svc.promptHints());
    }
  }

  // From explicit contextHints parameter
  if (contextHints && contextHints.length > 0) {
    allHints.push(...contextHints);
  }

  if (allHints.length > 0) {
    sections.push(`Additional context:\n${allHints.map((h) => `- ${h}`).join("\n")}`);
  }

  return sections.join("\n\n");
}
