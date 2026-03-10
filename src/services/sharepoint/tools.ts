import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import type {
  SharePointSite,
  SharePointList,
  SharePointListItem,
  SharePointDriveItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// sharepoint_sites — Search for SharePoint sites
// ---------------------------------------------------------------------------

export function sharepointSitesTool(): AgentTool {
  return {
    name: "sharepoint_sites",
    description:
      "Search for SharePoint sites by name or keyword. Returns matching sites with their IDs, URLs, and descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to find SharePoint sites by name.",
        },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const query = typeof input.query === "string" ? input.query : "";
      if (!query) return { content: "Error: query is required", isError: true };

      const response = await graphRequest<GraphCollectionResponse<SharePointSite>>({
        token: context.token,
        path: `/sites?search=${encodeURIComponent(query)}`,
      });

      const sites = response.value;
      if (sites.length === 0) {
        return { content: `No sites found matching '${query}'.` };
      }

      const lines = sites.map((site) => {
        const parts: string[] = [];
        parts.push(`- ${site.displayName}`);
        if (site.description) parts.push(`  Description: ${site.description}`);
        parts.push(`  URL: ${site.webUrl}`);
        if (site.siteCollection) parts.push(`  Host: ${site.siteCollection.hostname}`);
        parts.push(`  ID: ${site.id}`);
        return parts.join("\n");
      });

      return { content: `Found ${sites.length} site(s) matching '${query}':\n\n${lines.join("\n\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// sharepoint_site — Get site details
// ---------------------------------------------------------------------------

export function sharepointSiteTool(): AgentTool {
  return {
    name: "sharepoint_site",
    description:
      "Get detailed information about a specific SharePoint site by its ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        siteId: {
          type: "string",
          description: "The SharePoint site ID (e.g. 'contoso.sharepoint.com,site-guid,web-guid').",
        },
      },
      required: ["siteId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const siteId = typeof input.siteId === "string" ? input.siteId : "";
      if (!siteId) return { content: "Error: siteId is required", isError: true };

      const site = await graphRequest<SharePointSite>({
        token: context.token,
        path: `/sites/${siteId}`,
      });

      const lines: string[] = [];
      lines.push(`Name: ${site.displayName}`);
      if (site.description) lines.push(`Description: ${site.description}`);
      lines.push(`URL: ${site.webUrl}`);
      lines.push(`Created: ${formatDate(site.createdDateTime)}`);
      lines.push(`Modified: ${formatDate(site.lastModifiedDateTime)}`);
      if (site.siteCollection) lines.push(`Host: ${site.siteCollection.hostname}`);
      lines.push(`ID: ${site.id}`);

      return { content: lines.join("\n") };
    },
  };
}

// ---------------------------------------------------------------------------
// sharepoint_lists — List site lists (filter hidden)
// ---------------------------------------------------------------------------

export function sharepointListsTool(): AgentTool {
  return {
    name: "sharepoint_lists",
    description:
      "List the lists and libraries in a SharePoint site. Hidden system lists are filtered out.",
    inputSchema: {
      type: "object" as const,
      properties: {
        siteId: {
          type: "string",
          description: "The SharePoint site ID.",
        },
      },
      required: ["siteId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const siteId = typeof input.siteId === "string" ? input.siteId : "";
      if (!siteId) return { content: "Error: siteId is required", isError: true };

      const response = await graphRequest<GraphCollectionResponse<SharePointList>>({
        token: context.token,
        path: `/sites/${siteId}/lists`,
      });

      const allLists = response.value;
      if (allLists.length === 0) {
        return { content: "No lists found in this site." };
      }

      // Filter out hidden lists
      const visibleLists = allLists.filter((l) => !l.list?.hidden);
      if (visibleLists.length === 0) {
        return { content: "No visible lists found in this site (all lists are hidden system lists)." };
      }

      const lines = visibleLists.map((list) => {
        const parts: string[] = [];
        parts.push(`- ${list.displayName}`);
        if (list.description) parts.push(`  Description: ${list.description}`);
        if (list.list?.template) parts.push(`  Template: ${list.list.template}`);
        parts.push(`  Modified: ${formatDate(list.lastModifiedDateTime)}`);
        parts.push(`  ID: ${list.id}`);
        return parts.join("\n");
      });

      return { content: `${visibleLists.length} list(s):\n\n${lines.join("\n\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// sharepoint_list_items — Get items from a list
// ---------------------------------------------------------------------------

export function sharepointListItemsTool(): AgentTool {
  return {
    name: "sharepoint_list_items",
    description:
      "Get items from a SharePoint list, including all field values. Use the list ID from sharepoint_lists.",
    inputSchema: {
      type: "object" as const,
      properties: {
        siteId: {
          type: "string",
          description: "The SharePoint site ID.",
        },
        listId: {
          type: "string",
          description: "The list ID.",
        },
        top: {
          type: "number",
          description: "Maximum number of items to return (optional).",
        },
      },
      required: ["siteId", "listId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const siteId = typeof input.siteId === "string" ? input.siteId : "";
      if (!siteId) return { content: "Error: siteId is required", isError: true };

      const listId = typeof input.listId === "string" ? input.listId : "";
      if (!listId) return { content: "Error: listId is required", isError: true };

      let path = `/sites/${siteId}/lists/${listId}/items?$expand=fields`;
      const top = typeof input.top === "number" ? input.top : 0;
      if (top > 0) {
        path += `&$top=${top}`;
      }

      const response = await graphRequest<GraphCollectionResponse<SharePointListItem>>({
        token: context.token,
        path,
      });

      const items = response.value;
      if (items.length === 0) {
        return { content: "No items found in this list." };
      }

      const lines = items.map((item) => {
        const fieldEntries = Object.entries(item.fields)
          .filter(([key]) => !key.startsWith("@odata"))
          .map(([key, value]) => `  ${key}: ${value}`)
          .join("\n");
        const parts: string[] = [];
        parts.push(`- Item ${item.id}`);
        parts.push(fieldEntries);
        parts.push(`  Modified: ${formatDate(item.lastModifiedDateTime)}`);
        if (item.webUrl) parts.push(`  URL: ${item.webUrl}`);
        return parts.join("\n");
      });

      return { content: `${items.length} item(s):\n\n${lines.join("\n\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// sharepoint_files — List files in a site's drive root
// ---------------------------------------------------------------------------

export function sharepointFilesTool(): AgentTool {
  return {
    name: "sharepoint_files",
    description:
      "List files and folders in a SharePoint site's default document library (drive root).",
    inputSchema: {
      type: "object" as const,
      properties: {
        siteId: {
          type: "string",
          description: "The SharePoint site ID.",
        },
      },
      required: ["siteId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const siteId = typeof input.siteId === "string" ? input.siteId : "";
      if (!siteId) return { content: "Error: siteId is required", isError: true };

      const response = await graphRequest<GraphCollectionResponse<SharePointDriveItem>>({
        token: context.token,
        path: `/sites/${siteId}/drive/root/children`,
      });

      const items = response.value;
      if (items.length === 0) {
        return { content: "No files found in this site's document library." };
      }

      const lines = items.map((item) => {
        const parts: string[] = [];
        if (item.folder) {
          parts.push(`- [folder] ${item.name} (${item.folder.childCount} items)`);
        } else {
          const size = formatFileSize(item.size);
          const mime = item.file?.mimeType ?? "file";
          parts.push(`- [file] ${item.name}${size ? ` — ${size}` : ""} (${mime})`);
        }
        if (item.webUrl) parts.push(`  URL: ${item.webUrl}`);
        parts.push(`  Modified: ${formatDate(item.lastModifiedDateTime)}`);
        parts.push(`  ID: ${item.id}`);
        return parts.join("\n");
      });

      return { content: `${items.length} item(s) in document library:\n\n${lines.join("\n\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// sharepoint_search — Search files within a site
// ---------------------------------------------------------------------------

export function sharepointSearchTool(): AgentTool {
  return {
    name: "sharepoint_search",
    description:
      "Search for files within a SharePoint site's document library by keyword.",
    inputSchema: {
      type: "object" as const,
      properties: {
        siteId: {
          type: "string",
          description: "The SharePoint site ID.",
        },
        query: {
          type: "string",
          description: "Search query to find files by name or content.",
        },
      },
      required: ["siteId", "query"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const siteId = typeof input.siteId === "string" ? input.siteId : "";
      if (!siteId) return { content: "Error: siteId is required", isError: true };

      const query = typeof input.query === "string" ? input.query : "";
      if (!query) return { content: "Error: query is required", isError: true };

      const response = await graphRequest<GraphCollectionResponse<SharePointDriveItem>>({
        token: context.token,
        path: `/sites/${siteId}/drive/root/search(q='${encodeURIComponent(query)}')`,
      });

      const items = response.value;
      if (items.length === 0) {
        return { content: `No files found matching '${query}'.` };
      }

      const lines = items.map((item) => {
        const parts: string[] = [];
        if (item.folder) {
          parts.push(`- [folder] ${item.name} (${item.folder.childCount} items)`);
        } else {
          const size = formatFileSize(item.size);
          const mime = item.file?.mimeType ?? "file";
          parts.push(`- [file] ${item.name}${size ? ` — ${size}` : ""} (${mime})`);
        }
        if (item.parentReference?.path) {
          parts.push(`  Path: ${item.parentReference.path}`);
        }
        if (item.webUrl) parts.push(`  URL: ${item.webUrl}`);
        parts.push(`  ID: ${item.id}`);
        return parts.join("\n");
      });

      return { content: `Found ${items.length} result(s) for '${query}':\n\n${lines.join("\n\n")}` };
    },
  };
}
