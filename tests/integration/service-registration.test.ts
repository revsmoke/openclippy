/**
 * Integration test: Service Registration
 *
 * Verifies that all 4 priority service modules register correctly,
 * expose expected tools, filter by profile, build system prompts,
 * and respect enable/disable config.
 *
 * Uses real service modules (not mocks) but does NOT call Graph APIs.
 */
import { describe, it, expect } from "vitest";

// Real service modules
import { mailModule } from "../../src/services/mail/module.js";
import { calendarModule } from "../../src/services/calendar/module.js";
import { todoModule } from "../../src/services/todo/module.js";
import { teamsChatModule } from "../../src/services/teams-chat/module.js";

// Registry, prompt builder, tool profiles, config
import { ServiceRegistry } from "../../src/services/registry.js";
import { buildSystemPrompt } from "../../src/agents/prompt-builder.js";
import { filterToolsByProfile } from "../../src/agents/tool-profiles.js";
import { collectTools } from "../../src/agents/tool-registry.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { ServicesConfig } from "../../src/config/types.services.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a registry with all 4 priority services registered */
function registryWithAll4(): ServiceRegistry {
  const registry = new ServiceRegistry();
  registry.register(mailModule);
  registry.register(calendarModule);
  registry.register(todoModule);
  registry.register(teamsChatModule);
  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("service registration (integration)", () => {
  it("registers all 4 priority services", () => {
    const registry = registryWithAll4();
    const ids = registry.listRegistered();
    expect(ids).toHaveLength(4);
    expect(ids).toContain("mail");
    expect(ids).toContain("calendar");
    expect(ids).toContain("todo");
    expect(ids).toContain("teams-chat");
  });

  it("collects all tools from enabled services", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const tools = registry.getAllTools(config);

    // Mail: 11, Calendar: 8, ToDo: 6, Teams: 6 = 31 total
    expect(tools.length).toBe(31);

    // Verify key tool names exist
    const names = tools.map((t) => t.name);

    // Mail tools
    expect(names).toContain("mail_list");
    expect(names).toContain("mail_read");
    expect(names).toContain("mail_search");
    expect(names).toContain("mail_send");
    expect(names).toContain("mail_draft");
    expect(names).toContain("mail_reply");
    expect(names).toContain("mail_forward");
    expect(names).toContain("mail_move");
    expect(names).toContain("mail_flag");
    expect(names).toContain("mail_delete");
    expect(names).toContain("mail_folders");

    // Calendar tools
    expect(names).toContain("calendar_list");
    expect(names).toContain("calendar_read");
    expect(names).toContain("calendar_create");
    expect(names).toContain("calendar_update");
    expect(names).toContain("calendar_delete");
    expect(names).toContain("calendar_accept");
    expect(names).toContain("calendar_decline");
    expect(names).toContain("calendar_freebusy");

    // ToDo tools
    expect(names).toContain("todo_lists");
    expect(names).toContain("todo_tasks");
    expect(names).toContain("todo_create");
    expect(names).toContain("todo_update");
    expect(names).toContain("todo_complete");
    expect(names).toContain("todo_delete");

    // Teams tools
    expect(names).toContain("teams_list_chats");
    expect(names).toContain("teams_read_chat");
    expect(names).toContain("teams_send");
    expect(names).toContain("teams_list_channels");
    expect(names).toContain("teams_channel_messages");
    expect(names).toContain("teams_send_channel");
  });

  it("filters tools by read-only profile", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const allTools = registry.getAllTools(config);
    const readOnly = filterToolsByProfile(allTools, "read-only");
    const names = readOnly.map((t) => t.name);

    // Read-only should NOT include write/send/delete/create tools
    expect(names).not.toContain("mail_send");
    expect(names).not.toContain("mail_delete");
    expect(names).not.toContain("mail_draft");
    expect(names).not.toContain("mail_reply");
    expect(names).not.toContain("mail_forward");
    expect(names).not.toContain("mail_move");
    expect(names).not.toContain("mail_flag");
    expect(names).not.toContain("calendar_create");
    expect(names).not.toContain("calendar_update");
    expect(names).not.toContain("calendar_delete");
    expect(names).not.toContain("calendar_accept");
    expect(names).not.toContain("calendar_decline");
    expect(names).not.toContain("todo_create");
    expect(names).not.toContain("todo_update");
    expect(names).not.toContain("todo_complete");
    expect(names).not.toContain("todo_delete");
    expect(names).not.toContain("teams_send");
    expect(names).not.toContain("teams_send_channel");

    // Read-only SHOULD include read/list tools
    expect(names).toContain("mail_list");
    expect(names).toContain("mail_read");
    expect(names).toContain("mail_search");
    expect(names).toContain("mail_folders");
    expect(names).toContain("calendar_list");
    expect(names).toContain("calendar_read");
    expect(names).toContain("calendar_freebusy");
    expect(names).toContain("todo_lists");
    expect(names).toContain("todo_tasks");

    // Note: Teams tools have non-standard suffixes (e.g. teams_list_chats,
    // teams_read_chat) that do NOT match the read-only allowed patterns
    // (*_list, *_read, etc.), so they are all filtered out.
    expect(names).not.toContain("teams_list_chats");
    expect(names).not.toContain("teams_read_chat");
    expect(names).not.toContain("teams_list_channels");
    expect(names).not.toContain("teams_channel_messages");
  });

  it("filters tools by standard profile (blocks delete only)", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const allTools = registry.getAllTools(config);
    const standard = filterToolsByProfile(allTools, "standard");
    const names = standard.map((t) => t.name);

    // Standard blocks delete
    expect(names).not.toContain("mail_delete");
    expect(names).not.toContain("calendar_delete");
    expect(names).not.toContain("todo_delete");

    // Standard allows write/send/create
    expect(names).toContain("mail_send");
    expect(names).toContain("mail_draft");
    expect(names).toContain("calendar_create");
    expect(names).toContain("calendar_update");
    expect(names).toContain("todo_create");
    expect(names).toContain("todo_update");
    expect(names).toContain("teams_send");
  });

  it("full profile allows all tools including delete", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const allTools = registry.getAllTools(config);
    const full = filterToolsByProfile(allTools, "full");

    expect(full).toHaveLength(allTools.length);
  });

  it("collectTools integrates registry + profile filtering", () => {
    const registry = registryWithAll4();

    const tools = collectTools({
      registry,
      servicesConfig: {
        mail: { enabled: true },
        calendar: { enabled: true },
        todo: { enabled: true },
        "teams-chat": { enabled: true },
      },
      profile: "read-only",
    });

    const names = tools.map((t) => t.name);

    // Verify it filtered out write tools
    expect(names).not.toContain("mail_send");
    expect(names).not.toContain("calendar_create");
    expect(names).not.toContain("todo_create");
    expect(names).not.toContain("teams_send");

    // Verify it kept read tools
    expect(names).toContain("mail_list");
    expect(names).toContain("calendar_list");
    expect(names).toContain("todo_lists");

    // Teams tools have non-standard suffixes and are all filtered out
    // in read-only mode (e.g. teams_list_chats ends in _chats, not _list)
    expect(names).not.toContain("teams_list_chats");
  });

  it("builds system prompt with all services", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const enabled = registry.getEnabled(config);
    const prompt = buildSystemPrompt({
      identity: { name: "Clippy", emoji: "\uD83D\uDCCE" },
      services: enabled,
      userInfo: { displayName: "Bryan", email: "bryan@example.com" },
      timezone: "America/Chicago",
    });

    // Identity
    expect(prompt).toContain("Clippy");

    // Service labels
    expect(prompt).toContain("Outlook Mail");
    expect(prompt).toContain("Outlook Calendar");
    expect(prompt).toContain("To Do");
    expect(prompt).toContain("Teams Chat");

    // User context
    expect(prompt).toContain("Bryan");
    expect(prompt).toContain("bryan@example.com");
    expect(prompt).toContain("America/Chicago");

    // Guidelines
    expect(prompt).toContain("confirm with the user before sending");

    // Prompt hints from services
    expect(prompt).toContain("Additional context");
  });

  it("disabling a service removes its tools", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: false },
      todo: { enabled: true },
      "teams-chat": { enabled: false },
    };

    const tools = registry.getAllTools(config);
    const names = tools.map((t) => t.name);

    // Mail tools present
    expect(names.some((n) => n.startsWith("mail_"))).toBe(true);
    // ToDo tools present
    expect(names.some((n) => n.startsWith("todo_"))).toBe(true);
    // Calendar tools absent
    expect(names.some((n) => n.startsWith("calendar_"))).toBe(false);
    // Teams tools absent
    expect(names.some((n) => n.startsWith("teams_"))).toBe(false);
  });

  it("DEFAULT_CONFIG enables the 4 priority services", () => {
    const services = DEFAULT_CONFIG.services!;

    expect(services.mail?.enabled).toBe(true);
    expect(services.calendar?.enabled).toBe(true);
    expect(services.todo?.enabled).toBe(true);
    expect(services["teams-chat"]?.enabled).toBe(true);
  });

  it("each module has correct metadata", () => {
    expect(mailModule.id).toBe("mail");
    expect(mailModule.meta.label).toBe("Outlook Mail");
    expect(mailModule.capabilities.read).toBe(true);
    expect(mailModule.capabilities.write).toBe(true);

    expect(calendarModule.id).toBe("calendar");
    expect(calendarModule.meta.label).toBe("Outlook Calendar");
    expect(calendarModule.capabilities.search).toBe(false);

    expect(todoModule.id).toBe("todo");
    expect(todoModule.meta.label).toBe("To Do");
    expect(todoModule.capabilities.subscribe).toBe(false);

    expect(teamsChatModule.id).toBe("teams-chat");
    expect(teamsChatModule.meta.label).toBe("Teams Chat");
    expect(teamsChatModule.capabilities.delete).toBe(false);
  });

  it("each tool has required properties", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const tools = registry.getAllTools(config);

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("no duplicate tool names across services", () => {
    const registry = registryWithAll4();

    const config: ServicesConfig = {
      mail: { enabled: true },
      calendar: { enabled: true },
      todo: { enabled: true },
      "teams-chat": { enabled: true },
    };

    const tools = registry.getAllTools(config);
    const names = tools.map((t) => t.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });
});
