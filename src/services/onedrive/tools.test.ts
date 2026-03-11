import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DriveItem, Permission } from "./types.js";
import {
  filesListTool,
  filesReadTool,
  filesSearchTool,
  filesUploadTool,
  filesMkdirTool,
  filesDeleteTool,
  filesShareTool,
} from "./tools.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("../../graph/client.js", () => ({
  graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
}));

// Mock global fetch for file content download in files_read
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const ctx = createToolContext();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleFile: DriveItem = {
  id: "file-1",
  name: "report.docx",
  size: 25600,
  webUrl: "https://onedrive.live.com/redir?resid=file-1",
  createdDateTime: "2025-01-10T08:00:00Z",
  lastModifiedDateTime: "2025-01-15T14:30:00Z",
  parentReference: {
    path: "/drive/root:/Documents",
  },
  file: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};

const sampleTextFile: DriveItem = {
  id: "file-2",
  name: "notes.txt",
  size: 1024,
  webUrl: "https://onedrive.live.com/redir?resid=file-2",
  createdDateTime: "2025-02-01T10:00:00Z",
  lastModifiedDateTime: "2025-02-05T16:00:00Z",
  parentReference: {
    path: "/drive/root:",
  },
  file: {
    mimeType: "text/plain",
  },
  "@microsoft.graph.downloadUrl": "https://download.example.com/notes.txt",
};

const sampleFolder: DriveItem = {
  id: "folder-1",
  name: "Documents",
  size: 0,
  webUrl: "https://onedrive.live.com/redir?resid=folder-1",
  createdDateTime: "2024-06-01T09:00:00Z",
  lastModifiedDateTime: "2025-01-20T11:00:00Z",
  parentReference: {
    path: "/drive/root:",
  },
  folder: {
    childCount: 12,
  },
};

const sampleJsonFile: DriveItem = {
  id: "file-3",
  name: "config.json",
  size: 256,
  createdDateTime: "2025-03-01T10:00:00Z",
  lastModifiedDateTime: "2025-03-05T12:00:00Z",
  file: {
    mimeType: "application/json",
  },
  "@microsoft.graph.downloadUrl": "https://download.example.com/config.json",
};

const samplePermission: Permission = {
  id: "perm-1",
  roles: ["read"],
  link: {
    type: "view",
    scope: "organization",
    webUrl: "https://contoso-my.sharepoint.com/:w:/g/personal/user/abc123",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
  mockFetch.mockReset();
});

// ===================== files_list =====================

describe("files_list", () => {
  const tool = filesListTool();

  it("lists items in root by default", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleFolder, sampleFile],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 item(s)");
    expect(result.content).toContain("Documents");
    expect(result.content).toContain("report.docx");
    expect(result.content).toContain("12 items"); // folder child count
    expect(result.content).toContain("25.0 KB"); // file size

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/drive/root/children",
      }),
    );
  });

  it("lists items in a specific folder path", async () => {
    mockGraphRequest.mockResolvedValue({ value: [sampleFile] });

    const result = await tool.execute({ folderPath: "Documents/Reports" }, ctx);

    expect(result.content).toContain("Documents/Reports");
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/me/drive/root:/Documents/Reports:/children",
      }),
    );
  });

  it("returns message when folder is empty", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);

    expect(result.content).toBe("OneDrive root is empty.");
  });

  it("returns message for empty subfolder", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ folderPath: "Archive" }, ctx);

    expect(result.content).toBe("No items found in 'Archive'.");
  });

  it("sorts folders before files", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleFile, sampleFolder],
    });

    const result = await tool.execute({}, ctx);

    // Folder should appear before file in output
    const folderIdx = result.content.indexOf("Documents");
    const fileIdx = result.content.indexOf("report.docx");
    expect(folderIdx).toBeLessThan(fileIdx);
  });
});

// ===================== files_read =====================

describe("files_read", () => {
  const tool = filesReadTool();

  it("returns file metadata", async () => {
    mockGraphRequest.mockResolvedValue(sampleFile);

    const result = await tool.execute({ itemId: "file-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Name: report.docx");
    expect(result.content).toContain("25.0 KB");
    expect(result.content).toContain("ID: file-1");
    expect(result.content).toContain("Web URL:");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/me/drive/items/file-1",
      }),
    );
  });

  it("returns folder metadata with child count", async () => {
    mockGraphRequest.mockResolvedValue(sampleFolder);

    const result = await tool.execute({ itemId: "folder-1" }, ctx);

    expect(result.content).toContain("Name: Documents");
    expect(result.content).toContain("Type: folder");
    expect(result.content).toContain("Child count: 12");
  });

  it("downloads text file content when includeContent=true", async () => {
    mockGraphRequest.mockResolvedValue(sampleTextFile);
    mockFetch.mockResolvedValue({
      text: () => Promise.resolve("Hello, world!\nThis is my notes file."),
    });

    const result = await tool.execute({ itemId: "file-2", includeContent: true }, ctx);

    expect(result.content).toContain("--- File Content ---");
    expect(result.content).toContain("Hello, world!");
    expect(mockFetch).toHaveBeenCalledWith("https://download.example.com/notes.txt");
  });

  it("downloads JSON file content when includeContent=true", async () => {
    mockGraphRequest.mockResolvedValue(sampleJsonFile);
    mockFetch.mockResolvedValue({
      text: () => Promise.resolve('{"key": "value"}'),
    });

    const result = await tool.execute({ itemId: "file-3", includeContent: true }, ctx);

    expect(result.content).toContain("--- File Content ---");
    expect(result.content).toContain('"key": "value"');
  });

  it("truncates large text content", async () => {
    const longContent = "x".repeat(10_000);
    mockGraphRequest.mockResolvedValue(sampleTextFile);
    mockFetch.mockResolvedValue({
      text: () => Promise.resolve(longContent),
    });

    const result = await tool.execute({ itemId: "file-2", includeContent: true }, ctx);

    expect(result.content).toContain("truncated at 8000 characters");
  });

  it("skips content download for binary files", async () => {
    mockGraphRequest.mockResolvedValue(sampleFile);

    const result = await tool.execute({ itemId: "file-1", includeContent: true }, ctx);

    expect(result.content).toContain("Content download skipped: binary file");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not download content by default", async () => {
    mockGraphRequest.mockResolvedValue(sampleTextFile);

    const result = await tool.execute({ itemId: "file-2" }, ctx);

    expect(result.content).not.toContain("--- File Content ---");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error when itemId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("itemId");
  });
});

// ===================== files_search =====================

describe("files_search", () => {
  const tool = filesSearchTool();

  it("returns search results", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleFile, sampleTextFile],
    });

    const result = await tool.execute({ query: "report" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 result(s)");
    expect(result.content).toContain("report.docx");
    expect(result.content).toContain("notes.txt");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/me/drive/root/search(q='"),
      }),
    );
  });

  it("shows parent path in search results", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleFile],
    });

    const result = await tool.execute({ query: "report" }, ctx);

    expect(result.content).toContain("(in /Documents)");
  });

  it("returns message when no results found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ query: "nonexistent" }, ctx);

    expect(result.content).toBe("No results found for 'nonexistent'.");
  });

  it("returns error when query is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("query");
  });
});

// ===================== files_upload =====================

describe("files_upload", () => {
  const tool = filesUploadTool();

  it("uploads a file", async () => {
    const uploaded: DriveItem = {
      id: "new-file-1",
      name: "hello.txt",
      size: 13,
      createdDateTime: "2025-03-10T10:00:00Z",
      lastModifiedDateTime: "2025-03-10T10:00:00Z",
    };
    mockGraphRequest.mockResolvedValue(uploaded);

    const result = await tool.execute(
      { path: "Documents/hello.txt", content: "Hello, world!" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('File uploaded: "hello.txt"');
    expect(result.content).toContain("new-file-1");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/me/drive/root:/Documents/hello.txt:/content",
        body: "Hello, world!",
        headers: expect.objectContaining({ "Content-Type": "application/octet-stream" }),
      }),
    );
  });

  it("returns error when path is missing", async () => {
    const result = await tool.execute({ content: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("path");
  });

  it("returns error when content is missing", async () => {
    const result = await tool.execute({ path: "test.txt" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("content");
  });
});

// ===================== files_mkdir =====================

describe("files_mkdir", () => {
  const tool = filesMkdirTool();

  it("creates a folder in root", async () => {
    const created: DriveItem = {
      id: "new-folder-1",
      name: "New Folder",
      size: 0,
      folder: { childCount: 0 },
      createdDateTime: "2025-03-10T10:00:00Z",
      lastModifiedDateTime: "2025-03-10T10:00:00Z",
    };
    mockGraphRequest.mockResolvedValue(created);

    const result = await tool.execute({ name: "New Folder" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('Folder created: "New Folder"');
    expect(result.content).toContain("new-folder-1");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/drive/root/children",
        body: {
          name: "New Folder",
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename",
        },
      }),
    );
  });

  it("creates a folder under a parent path", async () => {
    const created: DriveItem = {
      id: "new-folder-2",
      name: "Reports",
      size: 0,
      folder: { childCount: 0 },
      createdDateTime: "2025-03-10T10:00:00Z",
      lastModifiedDateTime: "2025-03-10T10:00:00Z",
    };
    mockGraphRequest.mockResolvedValue(created);

    const result = await tool.execute({ name: "Reports", parentPath: "Documents" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/me/drive/root:/Documents:/children",
      }),
    );
  });

  it("returns error when name is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("name");
  });
});

// ===================== files_delete =====================

describe("files_delete", () => {
  const tool = filesDeleteTool();

  it("deletes an item", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({ itemId: "file-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("file-1 deleted");
    expect(result.content).toContain("recycle bin");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/me/drive/items/file-1",
      }),
    );
  });

  it("returns error when itemId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("itemId");
  });
});

// ===================== files_share =====================

describe("files_share", () => {
  const tool = filesShareTool();

  it("creates a sharing link with default scope", async () => {
    mockGraphRequest.mockResolvedValue(samplePermission);

    const result = await tool.execute({ itemId: "file-1", type: "view" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Sharing link created");
    expect(result.content).toContain("view");
    expect(result.content).toContain("organization");
    expect(result.content).toContain("https://contoso-my.sharepoint.com");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/me/drive/items/file-1/createLink",
        body: { type: "view", scope: "organization" },
      }),
    );
  });

  it("creates an anonymous edit link", async () => {
    const editPerm: Permission = {
      id: "perm-2",
      roles: ["write"],
      link: {
        type: "edit",
        scope: "anonymous",
        webUrl: "https://contoso-my.sharepoint.com/:w:/g/personal/user/xyz789",
      },
    };
    mockGraphRequest.mockResolvedValue(editPerm);

    const result = await tool.execute(
      { itemId: "file-1", type: "edit", scope: "anonymous" },
      ctx,
    );

    expect(result.content).toContain("edit");
    expect(result.content).toContain("anonymous");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { type: "edit", scope: "anonymous" },
      }),
    );
  });

  it("returns error when webUrl is missing from response", async () => {
    mockGraphRequest.mockResolvedValue({
      id: "perm-3",
      roles: ["read"],
    });

    const result = await tool.execute({ itemId: "file-1", type: "view" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("no URL was returned");
  });

  it("returns error when itemId is missing", async () => {
    const result = await tool.execute({ type: "view" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("itemId");
  });

  it("returns error when type is missing", async () => {
    const result = await tool.execute({ itemId: "file-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("type");
  });
});

// ===================== Module integration =====================

describe("onedriveModule integration", () => {
  it("exports 7 tools with correct names", async () => {
    const { onedriveModule } = await import("./module.js");
    const tools = onedriveModule.tools();

    expect(tools).toHaveLength(7);
    expect(tools.map((t) => t.name)).toEqual([
      "files_list",
      "files_read",
      "files_search",
      "files_upload",
      "files_mkdir",
      "files_delete",
      "files_share",
    ]);
  });

  it("has correct module metadata", async () => {
    const { onedriveModule } = await import("./module.js");

    expect(onedriveModule.id).toBe("onedrive");
    expect(onedriveModule.meta.requiredScopes).toContain("Files.Read");
    expect(onedriveModule.meta.optionalScopes).toContain("Files.ReadWrite");
    expect(onedriveModule.capabilities.read).toBe(true);
    expect(onedriveModule.capabilities.write).toBe(true);
    expect(onedriveModule.capabilities.delete).toBe(true);
    expect(onedriveModule.capabilities.search).toBe(true);
  });

  it("provides prompt hints", async () => {
    const { onedriveModule } = await import("./module.js");

    const hints = onedriveModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
