import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OnenoteNotebook, OnenoteSection, OnenotePage } from "./types.js";
import {
  onenoteNotebooksTool,
  onenoteSectionsTool,
  onenotePagesTool,
  onenoteReadTool,
  onenoteCreateTool,
} from "./tools.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

// ---------------------------------------------------------------------------
// Mock graphRequest
// ---------------------------------------------------------------------------

const mockGraphRequest = vi.fn();

vi.mock("../../graph/client.js", () => ({
  graphRequest: (...args: unknown[]) => mockGraphRequest(...args),
}));

// Mock global fetch for onenote_read (direct fetch for HTML content)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const ctx = createToolContext();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleNotebook: OnenoteNotebook = {
  id: "nb-1",
  displayName: "Work Notebook",
  createdDateTime: "2025-01-10T08:00:00Z",
  lastModifiedDateTime: "2025-02-15T14:30:00Z",
  isDefault: true,
  isShared: false,
  links: {
    oneNoteClientUrl: { href: "onenote:https://contoso.com/nb1" },
    oneNoteWebUrl: { href: "https://contoso.com/nb1" },
  },
};

const sampleNotebookMinimal: OnenoteNotebook = {
  id: "nb-2",
  displayName: "Personal Notes",
  createdDateTime: "2025-03-01T10:00:00Z",
  lastModifiedDateTime: "2025-03-01T10:00:00Z",
};

const sampleSection: OnenoteSection = {
  id: "sec-1",
  displayName: "Meeting Notes",
  createdDateTime: "2025-01-10T08:00:00Z",
  lastModifiedDateTime: "2025-02-20T09:00:00Z",
  isDefault: true,
  pagesUrl: "https://graph.microsoft.com/v1.0/me/onenote/sections/sec-1/pages",
};

const sampleSectionMinimal: OnenoteSection = {
  id: "sec-2",
  displayName: "Ideas",
  createdDateTime: "2025-02-01T12:00:00Z",
  lastModifiedDateTime: "2025-02-01T12:00:00Z",
};

const samplePage: OnenotePage = {
  id: "page-1",
  title: "Sprint Planning 2025-01-15",
  createdDateTime: "2025-01-15T09:00:00Z",
  lastModifiedDateTime: "2025-01-15T10:30:00Z",
  contentUrl: "https://graph.microsoft.com/v1.0/me/onenote/pages/page-1/content",
  level: 0,
  order: 0,
  self: "https://graph.microsoft.com/v1.0/me/onenote/pages/page-1",
};

const samplePageMinimal: OnenotePage = {
  id: "page-2",
  title: "Quick Note",
  createdDateTime: "2025-02-10T16:00:00Z",
  lastModifiedDateTime: "2025-02-10T16:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
  mockFetch.mockReset();
});

describe("onenote_notebooks", () => {
  const tool = onenoteNotebooksTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("onenote_notebooks");
    expect(tool.description).toBeTruthy();
    // No required params
  });

  it("lists notebooks with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleNotebook, sampleNotebookMinimal],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 notebook");
    expect(result.content).toContain("Work Notebook");
    expect(result.content).toContain("nb-1");
    expect(result.content).toContain("Personal Notes");
    expect(result.content).toContain("nb-2");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/onenote/notebooks",
      }),
    );
  });

  it("lists notebook with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleNotebookMinimal],
    });

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Personal Notes");
    expect(result.content).toContain("1 notebook");
  });

  it("returns message when no notebooks found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("No notebooks found");
  });
});

describe("onenote_sections", () => {
  const tool = onenoteSectionsTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("onenote_sections");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("notebookId");
  });

  it("lists sections with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleSection, sampleSectionMinimal],
    });

    const result = await tool.execute({ notebookId: "nb-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 section");
    expect(result.content).toContain("Meeting Notes");
    expect(result.content).toContain("sec-1");
    expect(result.content).toContain("Ideas");
    expect(result.content).toContain("sec-2");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/onenote/notebooks/nb-1/sections",
      }),
    );
  });

  it("lists section with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [sampleSectionMinimal],
    });

    const result = await tool.execute({ notebookId: "nb-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Ideas");
    expect(result.content).toContain("1 section");
  });

  it("returns error when notebookId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("notebookId");
  });

  it("returns message when no sections found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ notebookId: "nb-1" }, ctx);

    expect(result.content).toContain("No sections found");
  });
});

describe("onenote_pages", () => {
  const tool = onenotePagesTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("onenote_pages");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("sectionId");
  });

  it("lists pages with full data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [samplePage, samplePageMinimal],
    });

    const result = await tool.execute({ sectionId: "sec-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("2 page");
    expect(result.content).toContain("Sprint Planning 2025-01-15");
    expect(result.content).toContain("page-1");
    expect(result.content).toContain("Quick Note");
    expect(result.content).toContain("page-2");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/onenote/sections/sec-1/pages",
      }),
    );
  });

  it("lists page with minimal data", async () => {
    mockGraphRequest.mockResolvedValue({
      value: [samplePageMinimal],
    });

    const result = await tool.execute({ sectionId: "sec-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Quick Note");
    expect(result.content).toContain("1 page");
  });

  it("returns error when sectionId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("sectionId");
  });

  it("returns message when no pages found", async () => {
    mockGraphRequest.mockResolvedValue({ value: [] });

    const result = await tool.execute({ sectionId: "sec-1" }, ctx);

    expect(result.content).toContain("No pages found");
  });
});

describe("onenote_read", () => {
  const tool = onenoteReadTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("onenote_read");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("pageId");
  });

  it("reads page HTML content", async () => {
    const htmlContent = "<html><body><h1>Meeting Notes</h1><p>Action items discussed.</p></body></html>";
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(htmlContent),
    });

    const result = await tool.execute({ pageId: "page-1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain(htmlContent);

    // Verify fetch was called with correct URL and headers
    expect(mockFetch).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me/onenote/pages/page-1/content",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          Accept: "text/html",
        }),
      }),
    );
  });

  it("returns error when pageId is missing", async () => {
    const result = await tool.execute({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("pageId");
  });

  it("returns error on fetch failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    const result = await tool.execute({ pageId: "bad-page" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Error");
    expect(result.content).toContain("404");
  });
});

describe("onenote_create", () => {
  const tool = onenoteCreateTool();

  it("has correct tool metadata", () => {
    expect(tool.name).toBe("onenote_create");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.required).toContain("sectionId");
    expect(tool.inputSchema.required).toContain("htmlContent");
  });

  it("creates a page with HTML content", async () => {
    const createdPage: OnenotePage = {
      id: "new-page-1",
      title: "New Page",
      createdDateTime: "2025-03-01T10:00:00Z",
      lastModifiedDateTime: "2025-03-01T10:00:00Z",
      contentUrl: "https://graph.microsoft.com/v1.0/me/onenote/pages/new-page-1/content",
    };
    mockGraphRequest.mockResolvedValue(createdPage);

    const result = await tool.execute({
      sectionId: "sec-1",
      htmlContent: "<p>Hello World</p>",
    }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("new-page-1");
    expect(result.content).toContain("New Page");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/onenote/sections/sec-1/pages",
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/xhtml+xml",
        }),
      }),
    );
  });

  it("creates a page with title wrapping", async () => {
    const createdPage: OnenotePage = {
      id: "new-page-2",
      title: "My Title",
      createdDateTime: "2025-03-01T10:00:00Z",
      lastModifiedDateTime: "2025-03-01T10:00:00Z",
    };
    mockGraphRequest.mockResolvedValue(createdPage);

    const result = await tool.execute({
      sectionId: "sec-1",
      htmlContent: "<p>Body text</p>",
      title: "My Title",
    }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("My Title");

    // Verify body was wrapped with title in HTML structure
    const callBody = mockGraphRequest.mock.calls[0][0].body as string;
    expect(callBody).toContain("<title>My Title</title>");
    expect(callBody).toContain("<p>Body text</p>");
    expect(callBody).toContain("<!DOCTYPE html>");
  });

  it("returns error when sectionId is missing", async () => {
    const result = await tool.execute({ htmlContent: "<p>Hi</p>" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("sectionId");
  });

  it("returns error when htmlContent is missing", async () => {
    const result = await tool.execute({ sectionId: "sec-1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("htmlContent");
  });
});

describe("onenoteModule integration", () => {
  it("exports 5 tools with correct names", async () => {
    const { onenoteModule } = await import("./module.js");
    const tools = onenoteModule.tools();

    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name)).toEqual([
      "onenote_notebooks",
      "onenote_sections",
      "onenote_pages",
      "onenote_read",
      "onenote_create",
    ]);
  });

  it("has correct module metadata", async () => {
    const { onenoteModule } = await import("./module.js");

    expect(onenoteModule.id).toBe("onenote");
    expect(onenoteModule.meta.requiredScopes).toContain("Notes.Read");
    expect(onenoteModule.capabilities.read).toBe(true);
    expect(onenoteModule.capabilities.write).toBe(true);
    expect(onenoteModule.capabilities.delete).toBe(false);
    expect(onenoteModule.capabilities.search).toBe(false);
  });

  it("provides prompt hints", async () => {
    const { onenoteModule } = await import("./module.js");

    const hints = onenoteModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
