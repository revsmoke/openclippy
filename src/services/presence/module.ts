import type { ServiceModule } from "../types.js";
import {
  presenceReadTool,
  presenceSetTool,
  presenceClearTool,
} from "./tools.js";

/**
 * Microsoft Teams Presence service module.
 *
 * Exposes 3 tools for reading and managing user presence/availability
 * via the Microsoft Graph API.
 */
export const presenceModule: ServiceModule = {
  id: "presence",

  meta: {
    label: "Presence",
    description: "Microsoft Teams presence — read availability, set preferred presence, clear overrides.",
    requiredScopes: ["Presence.Read"],
    optionalScopes: ["Presence.ReadWrite"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: false,
    search: false,
    subscribe: false,
  },

  tools: () => [
    presenceReadTool(),
    presenceSetTool(),
    presenceClearTool(),
  ],

  promptHints: () => [
    "Use presence_read to check the user's current Teams availability before scheduling or messaging.",
    "Use presence_set with an ISO 8601 duration (e.g. PT1H) to override presence; use presence_clear to restore automatic detection.",
    "Availability values: Available, Busy, DoNotDisturb, BeRightBack, Away, Offline.",
  ],
};
