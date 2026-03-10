import type { ServiceModule } from "../types.js";
import {
  onenoteNotebooksTool,
  onenoteSectionsTool,
  onenotePagesTool,
  onenoteReadTool,
  onenoteCreateTool,
} from "./tools.js";

/**
 * Microsoft OneNote service module.
 *
 * Exposes 5 tools for browsing and creating OneNote notebooks,
 * sections, and pages via the Microsoft Graph API.
 */
export const onenoteModule: ServiceModule = {
  id: "onenote",

  meta: {
    label: "OneNote",
    description: "Microsoft OneNote notebooks, sections, and pages",
    requiredScopes: ["Notes.Read"],
    optionalScopes: ["Notes.ReadWrite"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: false,
    search: false,
    subscribe: false,
  },

  tools: () => [
    onenoteNotebooksTool(),
    onenoteSectionsTool(),
    onenotePagesTool(),
    onenoteReadTool(),
    onenoteCreateTool(),
  ],

  promptHints: () => [
    "Use onenote_notebooks to list the user's OneNote notebooks",
    "Use onenote_sections then onenote_pages to navigate notebook structure",
    "Use onenote_read to get the HTML content of a specific page",
    "Use onenote_create to create a new page in a section with HTML content",
  ],
};
