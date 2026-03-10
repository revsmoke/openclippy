import type { ServiceId } from "../config/types.services.js";

/** Maps each service to its required Graph API scopes */
const SERVICE_SCOPES: Record<ServiceId, { required: string[]; optional: string[] }> = {
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

  /** Record scopes that were granted after authentication */
  recordGrantedScopes(scopes: string[]): void {
    for (const s of scopes) {
      this.grantedScopes.add(s);
    }
  }

  /** Compute all scopes needed for a set of enabled services */
  computeRequiredScopes(enabledServices: ServiceId[]): string[] {
    const scopes = new Set(BASE_SCOPES);
    for (const id of enabledServices) {
      const cfg = SERVICE_SCOPES[id];
      if (cfg) {
        for (const s of cfg.required) scopes.add(s);
        for (const s of cfg.optional) scopes.add(s);
      }
    }
    return [...scopes];
  }

  /** Check if all required scopes for a service are granted */
  hasRequiredScopes(service: ServiceId): boolean {
    const cfg = SERVICE_SCOPES[service];
    if (!cfg) return false;
    return cfg.required.every((s) => this.grantedScopes.has(s));
  }

  /** Get scopes that haven't been granted yet */
  getMissingScopes(services: ServiceId[]): string[] {
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
}
