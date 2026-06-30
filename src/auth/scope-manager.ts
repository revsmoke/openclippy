import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BuiltinServiceId } from "../config/types.services.js";
import { GRANTED_SCOPES_PATH } from "../config/paths.js";

/** Maps each builtin service to its required Graph API scopes */
const SERVICE_SCOPES: Record<BuiltinServiceId, { required: string[]; optional: string[] }> = {
  mail: {
    required: ["Mail.Read"],
    optional: ["Mail.ReadWrite", "Mail.Send"],
  },
  calendar: {
    required: ["Calendars.Read"],
    optional: ["Calendars.ReadWrite"],
  },
  todo: {
    required: ["Tasks.Read"],
    optional: ["Tasks.ReadWrite"],
  },
  "teams-chat": {
    required: ["Chat.Read"],
    optional: ["Chat.ReadWrite", "ChatMessage.Send"],
  },
  onedrive: {
    required: ["Files.Read"],
    optional: ["Files.ReadWrite"],
  },
  planner: {
    required: ["Tasks.Read"],
    optional: ["Tasks.ReadWrite"],
  },
  onenote: {
    required: ["Notes.Read"],
    optional: ["Notes.ReadWrite"],
  },
  sharepoint: {
    required: ["Sites.Read.All"],
    optional: ["Sites.ReadWrite.All"],
  },
  people: {
    required: ["People.Read"],
    optional: ["Contacts.Read", "Contacts.ReadWrite"],
  },
  presence: {
    required: ["Presence.Read"],
    optional: ["Presence.Read.All"],
  },
};

const BASE_SCOPES = ["User.Read", "offline_access"];

export class ScopeManager {
  private grantedScopes = new Set<string>();

  /** Map of dynamically registered plugin scopes */
  private pluginScopes = new Map<string, { required: string[]; optional: string[] }>();

  /** Record scopes that were granted after authentication */
  recordGrantedScopes(scopes: string[]): void {
    for (const s of scopes) {
      this.grantedScopes.add(s);
    }
  }

  /** Register scopes for a plugin service */
  registerPluginScopes(serviceId: string, scopes: { required: string[]; optional: string[] }): void {
    this.pluginScopes.set(serviceId, scopes);
  }

  /** Compute all scopes needed for a set of enabled services */
  computeRequiredScopes(enabledServices: string[]): string[] {
    const scopes = new Set(BASE_SCOPES);
    for (const id of enabledServices) {
      // Check builtin scopes first
      const cfg = SERVICE_SCOPES[id as BuiltinServiceId];
      if (cfg) {
        for (const s of cfg.required) scopes.add(s);
        for (const s of cfg.optional) scopes.add(s);
      }
      // Check plugin scopes
      const pluginCfg = this.pluginScopes.get(id);
      if (pluginCfg) {
        for (const s of pluginCfg.required) scopes.add(s);
        for (const s of pluginCfg.optional) scopes.add(s);
      }
    }
    return [...scopes];
  }

  /** Check if all required scopes for a service are granted */
  hasRequiredScopes(service: string): boolean {
    const builtinCfg = SERVICE_SCOPES[service as BuiltinServiceId];
    const pluginCfg = this.pluginScopes.get(service);
    const cfg = builtinCfg ?? pluginCfg;
    if (!cfg) return false;
    return cfg.required.every((s) => this.grantedScopes.has(s));
  }

  /** Get scopes that haven't been granted yet */
  getMissingScopes(services: string[]): string[] {
    const needed = this.computeRequiredScopes(services);
    return needed.filter((s) => !this.grantedScopes.has(s));
  }

  /** Get the base scopes (always needed) */
  getBaseScopes(): string[] {
    return [...BASE_SCOPES];
  }

  /** Get all currently granted scopes */
  getGrantedScopes(): string[] {
    return [...this.grantedScopes];
  }

  /**
   * Persist the currently granted scopes to disk so other commands (e.g. status)
   * can verify which scopes were actually consented to during login.
   * The login command records granted scopes in memory only; without this the
   * status command has no way to know what was granted and reports everything
   * as "not verified".
   */
  async saveGrantedScopes(path: string = GRANTED_SCOPES_PATH): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify([...this.grantedScopes], null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Load previously persisted granted scopes from disk into this manager.
   * Silently no-ops if the file doesn't exist yet (e.g. never logged in) or
   * is unreadable, leaving the granted-scope set untouched.
   */
  async loadGrantedScopes(path: string = GRANTED_SCOPES_PATH): Promise<void> {
    try {
      const data = await readFile(path, "utf-8");
      const scopes = JSON.parse(data) as unknown;
      if (Array.isArray(scopes)) {
        for (const s of scopes) {
          if (typeof s === "string") this.grantedScopes.add(s);
        }
      }
    } catch {
      // No persisted scopes yet — leave grantedScopes as-is
    }
  }
}
