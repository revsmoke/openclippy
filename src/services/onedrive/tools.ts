import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { missingParam, formatShortDate, formatFileSize } from "../tool-utils.js";
import type { DriveItem, Permission } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/javascript"];
const MAX_CONTENT_LENGTH = 8_000; // characters to return for text file content

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function itemTypeLabel(item: DriveItem): string {
  if (item.folder) return "folder";
  return item.file?.mimeType ?? "file";
}

function formatItem(item: DriveItem): string {
  const icon = item.folder ? "📁" : "📄";
  const sizeStr = item.folder ? `${item.folder.childCount} items` : formatFileSize(item.size);
  const modified = formatShortDate(item.lastModifiedDateTime);
  return `${icon} ${item.name} — ${sizeStr}, modified ${modified} — id: ${item.id}`;
}

// ---------------------------------------------------------------------------
// files_list
// ---------------------------------------------------------------------------

export function filesListTool(): AgentTool {
  return {
    name: "files_list",
    description:
      "List files and folders in the user's OneDrive. Lists root by default, or specify a folder path (e.g. 'Documents/Reports') to list a subfolder.",
    inputSchema: {
      type: "object",
      properties: {
        folderPath: {
          type: "string",
          description:
            "Optional folder path relative to OneDrive root (e.g. 'Documents/Reports'). Omit for root.",
        },
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const folderPath = input.folderPath as string | undefined;

      const path = folderPath
        ? `/me/drive/root:/${folderPath}:/children`
        : "/me/drive/root/children";

      const response = await graphRequest<GraphCollectionResponse<DriveItem>>({
        token: context.token,
        path,
      });

      const items = response.value;
      if (items.length === 0) {
        return { content: folderPath ? `No items found in '${folderPath}'.` : "OneDrive root is empty." };
      }

      // Sort folders first, then files
      const sorted = [...items].sort((a, b) => {
        if (a.folder && !b.folder) return -1;
        if (!a.folder && b.folder) return 1;
        return a.name.localeCompare(b.name);
      });

      const lines = sorted.map(formatItem);
      const label = folderPath ?? "root";
      return { content: `${label} — ${items.length} item(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// files_read
// ---------------------------------------------------------------------------

export function filesReadTool(): AgentTool {
  return {
    name: "files_read",
    description:
      "Get metadata for a file or folder in OneDrive by item ID. For text-based files, optionally download and return the content (truncated if large).",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The DriveItem ID." },
        includeContent: {
          type: "boolean",
          description:
            "If true and the file is text-based (text/*, JSON, XML, JS), download and return the file content. Defaults to false.",
        },
      },
      required: ["itemId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const itemId = input.itemId as string | undefined;
      if (!itemId) return missingParam("itemId");

      const includeContent = input.includeContent === true;

      const item = await graphRequest<DriveItem>({
        token: context.token,
        path: `/me/drive/items/${itemId}`,
      });

      const lines: string[] = [];
      lines.push(`Name: ${item.name}`);
      lines.push(`Type: ${itemTypeLabel(item)}`);
      lines.push(`Size: ${formatFileSize(item.size)}`);
      lines.push(`Modified: ${formatShortDate(item.lastModifiedDateTime)}`);
      lines.push(`Created: ${formatShortDate(item.createdDateTime)}`);
      if (item.webUrl) lines.push(`Web URL: ${item.webUrl}`);
      if (item.parentReference?.path) lines.push(`Path: ${item.parentReference.path}/${item.name}`);
      lines.push(`ID: ${item.id}`);

      if (item.folder) {
        lines.push(`Child count: ${item.folder.childCount}`);
      }

      // Optionally fetch text content
      if (includeContent && item.file && isTextMime(item.file.mimeType)) {
        const downloadUrl = item["@microsoft.graph.downloadUrl"];
        if (downloadUrl) {
          const res = await fetch(downloadUrl);
          let text = await res.text();
          let truncated = false;
          if (text.length > MAX_CONTENT_LENGTH) {
            text = text.slice(0, MAX_CONTENT_LENGTH);
            truncated = true;
          }
          lines.push("");
          lines.push("--- File Content ---");
          lines.push(text);
          if (truncated) {
            lines.push(`\n... (truncated at ${MAX_CONTENT_LENGTH} characters)`);
          }
        }
      } else if (includeContent && item.file && !isTextMime(item.file.mimeType)) {
        lines.push(`\nContent download skipped: binary file (${item.file.mimeType}).`);
      }

      return { content: lines.join("\n") };
    },
  };
}

// ---------------------------------------------------------------------------
// files_search
// ---------------------------------------------------------------------------

export function filesSearchTool(): AgentTool {
  return {
    name: "files_search",
    description:
      "Search for files and folders in OneDrive by name or content. Uses the Graph search(q='query') function.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string." },
      },
      required: ["query"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const query = input.query as string | undefined;
      if (!query) return missingParam("query");

      const response = await graphRequest<GraphCollectionResponse<DriveItem>>({
        token: context.token,
        path: `/me/drive/root/search(q='${encodeURIComponent(query)}')`,
      });

      const items = response.value;
      if (items.length === 0) {
        return { content: `No results found for '${query}'.` };
      }

      const lines = items.map((item) => {
        const pathStr = item.parentReference?.path
          ? ` (in ${item.parentReference.path.replace("/drive/root:", "")})`
          : "";
        return `${formatItem(item)}${pathStr}`;
      });

      return { content: `Found ${items.length} result(s) for '${query}':\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// files_upload
// ---------------------------------------------------------------------------

export function filesUploadTool(): AgentTool {
  return {
    name: "files_upload",
    description:
      "Upload a small file (< 4 MB) to OneDrive using a simple PUT. For files larger than 4 MB, use the Graph upload session API directly. Specify the destination path relative to OneDrive root.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Destination path relative to OneDrive root, including filename (e.g. 'Documents/notes.txt').",
        },
        content: {
          type: "string",
          description: "The file content as a text string.",
        },
      },
      required: ["path", "content"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const filePath = input.path as string | undefined;
      if (!filePath) return missingParam("path");

      const content = input.content as string | undefined;
      if (content === undefined || content === null) return missingParam("content");

      const item = await graphRequest<DriveItem>({
        token: context.token,
        path: `/me/drive/root:/${filePath}:/content`,
        method: "PUT",
        body: content,
        headers: { "Content-Type": "application/octet-stream" },
      });

      return {
        content: `File uploaded: "${item.name}" (${formatFileSize(item.size)}) — id: ${item.id}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// files_mkdir
// ---------------------------------------------------------------------------

export function filesMkdirTool(): AgentTool {
  return {
    name: "files_mkdir",
    description: "Create a new folder in OneDrive under the root or a specified parent folder.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the new folder." },
        parentPath: {
          type: "string",
          description:
            "Optional parent folder path relative to root (e.g. 'Documents'). Omit to create in root.",
        },
      },
      required: ["name"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const name = input.name as string | undefined;
      if (!name) return missingParam("name");

      const parentPath = input.parentPath as string | undefined;
      const apiPath = parentPath
        ? `/me/drive/root:/${parentPath}:/children`
        : "/me/drive/root/children";

      const item = await graphRequest<DriveItem>({
        token: context.token,
        path: apiPath,
        method: "POST",
        body: {
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename",
        },
      });

      return {
        content: `Folder created: "${item.name}" — id: ${item.id}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// files_delete
// ---------------------------------------------------------------------------

export function filesDeleteTool(): AgentTool {
  return {
    name: "files_delete",
    description: "Delete a file or folder from OneDrive by item ID. This moves the item to the recycle bin.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The DriveItem ID to delete." },
      },
      required: ["itemId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const itemId = input.itemId as string | undefined;
      if (!itemId) return missingParam("itemId");

      await graphRequest<undefined>({
        token: context.token,
        path: `/me/drive/items/${itemId}`,
        method: "DELETE",
      });

      return { content: `Item ${itemId} deleted (moved to recycle bin).` };
    },
  };
}

// ---------------------------------------------------------------------------
// files_share
// ---------------------------------------------------------------------------

export function filesShareTool(): AgentTool {
  return {
    name: "files_share",
    description:
      "Create a sharing link for a file or folder in OneDrive. Returns a URL that can be shared with others.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The DriveItem ID to share." },
        type: {
          type: "string",
          description: "Link type: 'view' for read-only, 'edit' for read-write.",
          enum: ["view", "edit"],
        },
        scope: {
          type: "string",
          description:
            "Link scope: 'anonymous' (anyone with link), 'organization' (same tenant only). Defaults to 'organization'.",
          enum: ["anonymous", "organization"],
        },
      },
      required: ["itemId", "type"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const itemId = input.itemId as string | undefined;
      if (!itemId) return missingParam("itemId");

      const linkType = input.type as string | undefined;
      if (!linkType) return missingParam("type");

      const scope = (input.scope as string) ?? "organization";

      const permission = await graphRequest<Permission>({
        token: context.token,
        path: `/me/drive/items/${itemId}/createLink`,
        method: "POST",
        body: { type: linkType, scope },
      });

      if (!permission.link?.webUrl) {
        return { content: "Sharing link created, but no URL was returned.", isError: true };
      }

      return {
        content: `Sharing link created (${linkType}, ${scope}):\n${permission.link.webUrl}`,
      };
    },
  };
}
