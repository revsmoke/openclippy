import type { ServiceModule } from "../types.js";
import {
  peopleSearchTool,
  contactsListTool,
  contactsReadTool,
} from "./tools.js";

/**
 * Microsoft People & Contacts service module.
 *
 * Exposes 3 tools for searching people and managing personal contacts
 * via the Microsoft Graph API.
 */
export const peopleModule: ServiceModule = {
  id: "people",

  meta: {
    label: "People & Contacts",
    description: "Search for people relevant to the user and manage Outlook personal contacts.",
    requiredScopes: ["People.Read", "Contacts.Read"],
  },

  capabilities: {
    read: true,
    write: false,
    delete: false,
    search: true,
    subscribe: false,
  },

  tools: () => [
    peopleSearchTool(),
    contactsListTool(),
    contactsReadTool(),
  ],

  promptHints: () => [
    "Use people_search to find colleagues and frequent contacts by name — it returns people ranked by relevance to the user.",
    "Use contacts_list and contacts_read to access Outlook personal contacts with full details (emails, phones, addresses).",
  ],
};
