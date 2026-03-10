import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../types.js";
import type {
  SharePointSite,
  SharePointList,
  SharePointListItem,
  SharePointDriveItem,
} from "./types.js";
import {
  sharepointSitesTool,
  sharepointSiteTool,
  sharepointListsTool,
  sharepointListItemsTool,
  sharepointFilesTool,
  sharepointSearchTool,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("../../graph/client.js", () => ({
  graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
}));

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const ctx: ToolContext = {
  token: "test-token",
  timezone: "America/New_York",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleSite: SharePointSite = {
  id: "contoso.sharepoint.com,site-id-1,web-id-1",
  displayName: "Contoso Team Site",
  name: "contoso-team",
  webUrl: "https://contoso.sharepoint.com/sites/contoso-team",
  createdDateTime: "2024-01-15T10:00:00Z",
  lastModifiedDateTime: "2025-03-01T14:30:00Z",
  description: "Main team collaboration site",
  siteCollection: { hostname: "contoso.sharepoint.com" },
};

const sampleSiteMinimal: SharePointSite = {
  id: "contoso.sharepoint.com,site-id-2,web-id-2",
  displayName: "Project Alpha",
  name: "project-alpha",
  webUrl: "https://contoso.sharepoint.com/sites/project-alpha",
  createdDateTime: "2025-02-01T09:00:00Z",
  lastModifiedDateTime: "2025-02-10T11:00:00Z",
};

const sampleList: SharePointList = {
  id: "list-1",
  displayName: "Tasks",
  description: "Project task tracking",
  webUrl: "https://contoso.sharepoint.com/sites/contoso-team/Lists/Tasks",
  createdDateTime: "2024-06-01T08:00:00Z",
  lastModifiedDateTime: "2025-03-05T16:00:00Z",
  list: { template: "genericList", hidden: false },
};

const hiddenList: SharePointList = {
  id: "list-hidden-1",
  displayName: "DO_NOT_DELETE_SPLIST_SITEASSETS",
  webUrl: "https://contoso.sharepoint.com/sites/contoso-team/Lists/Hidden",
  createdDateTime: "2024-01-01T00:00:00Z",
  lastModifiedDateTime: "2024-01-01T00:00:00Z",
  list: { template: "documentLibrary", hidden: true },
};

const sampleListMinimal: SharePointList = {
  id: "list-2",
  displayName: "Documents",
  webUrl: "https://contoso.sharepoint.com/sites/contoso-team/Lists/Documents",
  createdDateTime: "2024-06-01T08:00:00Z",
  lastModifiedDateTime: "2025-03-05T16:00:00Z",
};

const sampleListItem: SharePointListItem = {
  id: "item-1",
  fields: {
    Title: "Complete Q1 Report",
    Status: "In Progress",
    Priority: "High",
    AssignedTo: "user@contoso.com",
  },
  createdDateTime: "2025-02-20T09:00:00Z",
  lastModifiedDateTime: "2025-03-08T11:30:00Z",
  webUrl: "https://contoso.sharepoint.com/sites/contoso-team/Lists/Tasks/1",
};

const sampleListItemMinimal: SharePointListItem = {
  id: "item-2",
  fields: { Title: "Review budget" },
  createdDateTime: "2025-03-01T10:00:00Z",
  lastModifiedDateTime: "2025-03-01T10:00:00Z",
};

const sampleDriveItemFile: SharePointDriveItem = {
  id: "drive-item-1",
  name: "Q1-Report.docx",
  size: 1536000,
  webUrl: "https://contoso.sharepoint.com/sites/contoso-team/Shared%20Documents/Q1-Report.docx",
  file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  createdDateTime: "2025-01-10T08:00:00Z",
  lastModifiedDateTime: "2025-03-01T14:30:00Z",
  parentReference: { path: "/drives/drive-1/root:" },
};

const sampleDriveItemFolder: SharePointDriveItem = {
  id: "drive-item-2",
  name: "Reports",
  folder: { childCount: 5 },
  createdDateTime: "2024-06-15T09:00:00Z",
  lastModifiedDateTime: "2025-02-28T16:00:00Z",
};

const sampleDriveItemMinimal: SharePointDriveItem = {
  id: "drive-item-3",
  name: "notes.txt",
  size: 256,
  createdDateTime: "2025-03-05T10:00:00Z",
  lastModifiedDateTime: "2025-03-05T10:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
});

// ===================== sharepoint_sites =====================

describe("sharepoint_sites", () => {
  const tool = sharepointSitesTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("sharepoint_sites");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toEqual(["query"]);
  });

  it("searches for sites with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleSite, sampleSiteMinimal],
    });

    const result = await tool.execute({ query: "contoso" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2");
    expect(result.content).toContain("Contoso Team Site");
    expect(result.content).toContain("Project Alpha");
    expect(result.content).toContain("contoso.sharepoint.com");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/sites?search=contoso",
      }),
    );
  });

  it("searches with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleSiteMinimal],
    });

    const result = await tool.execute({ query: "alpha" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Project Alpha");
  });

  it("encodes the search query parameter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ query: "my site name" }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites?search=my%20site%20name",
      }),
    );
  });

  it("returns error when query is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("query");
  });

  it("handles empty results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ query: "nonexistent" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No sites found");
  });
});

// ===================== sharepoint_site =====================

describe("sharepoint_site", () => {
  const tool = sharepointSiteTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("sharepoint_site");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toEqual(["siteId"]);
  });

  it("returns full site details", async () => {
    mockGraphRequest.mockResolvedValue(sampleSite);

    const result = await tool.execute({ siteId: "contoso.sharepoint.com,site-id-1,web-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Contoso Team Site");
    expect(result.content).toContain("Main team collaboration site");
    expect(result.content).toContain("https://contoso.sharepoint.com/sites/contoso-team");
    expect(result.content).toContain("contoso.sharepoint.com,site-id-1,web-id-1");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites/contoso.sharepoint.com,site-id-1,web-id-1",
      }),
    );
  });

  it("returns minimal site details", async () => {
    mockGraphRequest.mockResolvedValue(sampleSiteMinimal);

    const result = await tool.execute({ siteId: "contoso.sharepoint.com,site-id-2,web-id-2" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Project Alpha");
  });

  it("returns error when siteId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("siteId");
  });
});

// ===================== sharepoint_lists =====================

describe("sharepoint_lists", () => {
  const tool = sharepointListsTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("sharepoint_lists");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toEqual(["siteId"]);
  });

  it("returns lists and filters hidden ones", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleList, hiddenList, sampleListMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Tasks");
    expect(result.content).toContain("Documents");
    expect(result.content).not.toContain("DO_NOT_DELETE_SPLIST_SITEASSETS");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites/site-id-1/lists",
      }),
    );
  });

  it("returns lists with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleListMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Documents");
  });

  it("returns error when siteId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("siteId");
  });

  it("handles empty results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No lists found");
  });

  it("handles all lists being hidden", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [hiddenList],
    });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No visible lists");
  });
});

// ===================== sharepoint_list_items =====================

describe("sharepoint_list_items", () => {
  const tool = sharepointListItemsTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("sharepoint_list_items");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toEqual(["siteId", "listId"]);
  });

  it("returns list items with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleListItem, sampleListItemMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1", listId: "list-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2");
    expect(result.content).toContain("Complete Q1 Report");
    expect(result.content).toContain("In Progress");
    expect(result.content).toContain("Review budget");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites/site-id-1/lists/list-1/items?$expand=fields",
      }),
    );
  });

  it("includes $expand=fields in the path", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ siteId: "site-id-1", listId: "list-1" }, ctx);

    const callPath = mockGraphRequest.mock.calls[0][0].path;
    expect(callPath).toContain("$expand=fields");
  });

  it("returns items with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleListItemMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1", listId: "list-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Review budget");
  });

  it("supports optional top parameter", async () => {
    mockGraphRequest.mockResolvedValue({ value: [sampleListItem] });

    await tool.execute({ siteId: "site-id-1", listId: "list-1", top: 5 }, ctx);

    const callPath = mockGraphRequest.mock.calls[0][0].path;
    expect(callPath).toContain("$top=5");
  });

  it("returns error when siteId is missing", async () => {
    const result = await tool.execute({ listId: "list-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("siteId");
  });

  it("returns error when listId is missing", async () => {
    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("listId");
  });

  it("handles empty results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ siteId: "site-id-1", listId: "list-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No items found");
  });
});

// ===================== sharepoint_files =====================

describe("sharepoint_files", () => {
  const tool = sharepointFilesTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("sharepoint_files");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toEqual(["siteId"]);
  });

  it("returns files with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleDriveItemFolder, sampleDriveItemFile],
    });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Q1-Report.docx");
    expect(result.content).toContain("Reports");
    expect(result.content).toContain("1.5 MB");
    expect(result.content).toContain("folder");
    expect(result.content).toContain("5");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites/site-id-1/drive/root/children",
      }),
    );
  });

  it("returns files with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleDriveItemMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("notes.txt");
  });

  it("returns error when siteId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("siteId");
  });

  it("handles empty results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No files found");
  });
});

// ===================== sharepoint_search =====================

describe("sharepoint_search", () => {
  const tool = sharepointSearchTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("sharepoint_search");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toEqual(["siteId", "query"]);
  });

  it("returns search results with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleDriveItemFile, sampleDriveItemMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1", query: "report" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2");
    expect(result.content).toContain("Q1-Report.docx");
    expect(result.content).toContain("notes.txt");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites/site-id-1/drive/root/search(q='report')",
      }),
    );
  });

  it("returns search results with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleDriveItemMinimal],
    });

    const result = await tool.execute({ siteId: "site-id-1", query: "notes" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("notes.txt");
  });

  it("encodes the search query", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    await tool.execute({ siteId: "site-id-1", query: "my document" }, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/sites/site-id-1/drive/root/search(q='my%20document')",
      }),
    );
  });

  it("returns error when siteId is missing", async () => {
    const result = await tool.execute({ query: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("siteId");
  });

  it("returns error when query is missing", async () => {
    const result = await tool.execute({ siteId: "site-id-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("query");
  });

  it("handles empty results", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ siteId: "site-id-1", query: "nonexistent" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("No files found");
  });
});

// ===================== Module integration =====================

describe("sharepointModule integration", () => {
  it("exports 6 tools with correct names", async () => {
    const { sharepointModule } = await import("./module.js");
    const tools = sharepointModule.tools();

    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      "sharepoint_sites",
      "sharepoint_site",
      "sharepoint_lists",
      "sharepoint_list_items",
      "sharepoint_files",
      "sharepoint_search",
    ]);
  });

  it("has correct module metadata", async () => {
    const { sharepointModule } = await import("./module.js");

    expect(sharepointModule.id).toBe("sharepoint");
    expect(sharepointModule.meta.label).toBe("SharePoint");
    expect(sharepointModule.meta.requiredScopes).toContain("Sites.Read.All");
    expect(sharepointModule.capabilities.read).toBe(true);
    expect(sharepointModule.capabilities.write).toBe(false);
    expect(sharepointModule.capabilities.delete).toBe(false);
    expect(sharepointModule.capabilities.search).toBe(true);
  });

  it("provides prompt hints", async () => {
    const { sharepointModule } = await import("./module.js");

    const hints = sharepointModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
    expect(hints!.some((h) => h.includes("sharepoint_sites"))).toBe(true);
  });
});
