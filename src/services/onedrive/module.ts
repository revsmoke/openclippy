import type { ServiceModule } from "../types.js";
import {
  filesListTool,
  filesReadTool,
  filesSearchTool,
  filesUploadTool,
  filesMkdirTool,
  filesDeleteTool,
  filesShareTool,
} from "./tools.js";

/**
 * OneDrive service module.
 *
 * Exposes 7 tools for managing files and folders in the user's OneDrive
 * via the Microsoft Graph API.
 */
export const onedriveModule: ServiceModule = {
  id: "onedrive",

  meta: {
    label: "OneDrive",
    description: "OneDrive file management — list, read, search, upload, create folders, delete, and share files.",
    requiredScopes: ["Files.Read"],
    optionalScopes: ["Files.ReadWrite"],
  },

  capabilities: {
    read: true,
    write: true,
    delete: true,
    search: true,
    subscribe: false,
  },

  tools: () => [
    filesListTool(),
    filesReadTool(),
    filesSearchTool(),
    filesUploadTool(),
    filesMkdirTool(),
    filesDeleteTool(),
    filesShareTool(),
  ],

  promptHints: () => [
    "Use files_list to browse OneDrive contents. Provide a folderPath to list a specific folder, or omit for root.",
    "Use files_read with an item ID to get file metadata. Set includeContent=true to read text file contents.",
    "files_upload is for small files under 4 MB only. Content is provided as a text string.",
    "files_search searches by file name and content across the entire OneDrive.",
  ],
};
