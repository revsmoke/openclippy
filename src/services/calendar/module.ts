import type { ServiceModule } from "../types.js";
import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { GraphEvent } from "./types.js";
import {
  calendarListTool,
  calendarReadTool,
  calendarCreateTool,
  calendarUpdateTool,
  calendarDeleteTool,
  calendarAcceptTool,
  calendarDeclineTool,
  calendarFreebusyTool,
} from "./tools.js";

export const calendarModule: ServiceModule = {
  id: "calendar",

  meta: {
    label: "Outlook Calendar",
    description: "View, create, update, and manage calendar events and check availability",
    requiredScopes: ["Calendars.Read"],
    optionalScopes: ["Calendars.ReadWrite"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: true,
    search: false,
    subscribe: true,
  },

  tools: () => [
    calendarListTool(),
    calendarReadTool(),
    calendarCreateTool(),
    calendarUpdateTool(),
    calendarDeleteTool(),
    calendarAcceptTool(),
    calendarDeclineTool(),
    calendarFreebusyTool(),
  ],

  status: {
    probe: async ({ token }) => {
      try {
        // Quick probe: fetch a single event to verify calendar access
        const now = new Date().toISOString();
        const later = new Date(Date.now() + 86_400_000).toISOString();
        await graphRequest<GraphCollectionResponse<GraphEvent>>({
          token,
          path: `/me/calendarView?startDateTime=${encodeURIComponent(now)}&endDateTime=${encodeURIComponent(later)}&$top=1&$select=id`,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  },

  subscriptions: {
    resources: ["/me/events"],
    changeTypes: ["created", "updated", "deleted"],
    handle: async (_notification) => {
      // Placeholder: subscription handling will be implemented when
      // the notification infrastructure is ready.
    },
  },

  promptHints: () => [
    "User has Outlook Calendar access. Can list events, read event details, create/update/delete events, accept/decline invitations, and check free/busy availability.",
  ],
};
