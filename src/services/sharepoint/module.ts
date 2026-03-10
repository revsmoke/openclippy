import type { ServiceModule } from "../types.js";
import {
  sharepointSitesTool,
  sharepointSiteTool,
  sharepointListsTool,
  sharepointListItemsTool,
  sharepointFilesTool,
  sharepointSearchTool,
} from "./tools.js";

/**
 * SharePoint service module.
 *
 * Exposes 6 tools for browsing SharePoint sites, lists, list items,
 * and document libraries via the Microsoft Graph API.
 */
export const sharepointModule: ServiceModule = {
  id: "sharepoint",

  meta: {
    label: "SharePoint",
    description: "SharePoint sites, lists, and document libraries",
    requiredScopes: ["Sites.Read.All"],
    optionalScopes: ["Sites.ReadWrite.All"],
  },

  capabilities: {
    read: true,
    write: false,
    delete: false,
    search: true,
    subscribe: false,
  },

  tools: () => [
    sharepointSitesTool(),
    sharepointSiteTool(),
    sharepointListsTool(),
    sharepointListItemsTool(),
    sharepointFilesTool(),
    sharepointSearchTool(),
  ],

  promptHints: () => [
    "Use sharepoint_sites to search for SharePoint sites by name",
    "Use sharepoint_lists to see the lists/libraries in a site",
    "Use sharepoint_list_items to read data from a SharePoint list",
    "Use sharepoint_files to browse files in a site's document library",
    "Use sharepoint_search to find files within a site by keyword",
  ],
};
