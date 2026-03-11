import { graphRequest } from "../../graph/client.js";
import type { GraphCollectionResponse } from "../../graph/client.js";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";
import { missingParam } from "../tool-utils.js";
import type { OnenoteNotebook, OnenoteSection, OnenotePage } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNotebook(nb: OnenoteNotebook): string {
  const parts: string[] = [`- ${nb.displayName}`];
  if (nb.isDefault) parts.push(`  Default: yes`);
  if (nb.isShared) parts.push(`  Shared: yes`);
  if (nb.links?.oneNoteWebUrl?.href) parts.push(`  Web URL: ${nb.links.oneNoteWebUrl.href}`);
  parts.push(`  Created: ${nb.createdDateTime}`);
  parts.push(`  Modified: ${nb.lastModifiedDateTime}`);
  parts.push(`  id: ${nb.id}`);
  return parts.join("\n");
}

function formatSection(sec: OnenoteSection): string {
  const parts: string[] = [`- ${sec.displayName}`];
  if (sec.isDefault) parts.push(`  Default: yes`);
  parts.push(`  Created: ${sec.createdDateTime}`);
  parts.push(`  Modified: ${sec.lastModifiedDateTime}`);
  parts.push(`  id: ${sec.id}`);
  return parts.join("\n");
}

function formatPage(page: OnenotePage): string {
  const parts: string[] = [`- ${page.title}`];
  parts.push(`  Created: ${page.createdDateTime}`);
  parts.push(`  Modified: ${page.lastModifiedDateTime}`);
  if (page.level !== undefined) parts.push(`  Level: ${page.level}`);
  if (page.order !== undefined) parts.push(`  Order: ${page.order}`);
  parts.push(`  id: ${page.id}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// onenote_notebooks
// ---------------------------------------------------------------------------

export function onenoteNotebooksTool(): AgentTool {
  return {
    name: "onenote_notebooks",
    description:
      "List the user's OneNote notebooks. Returns notebook names, IDs, creation dates, and web URLs.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const response = await graphRequest<GraphCollectionResponse<OnenoteNotebook>>({
        token: context.token,
        path: "/me/onenote/notebooks",
      });

      const notebooks = response.value;
      if (notebooks.length === 0) {
        return { content: "No notebooks found." };
      }

      const lines = notebooks.map(formatNotebook);
      return { content: `Found ${notebooks.length} notebook(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// onenote_sections
// ---------------------------------------------------------------------------

export function onenoteSectionsTool(): AgentTool {
  return {
    name: "onenote_sections",
    description:
      "List sections within a specific OneNote notebook. Returns section names, IDs, and dates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        notebookId: { type: "string", description: "The notebook ID to list sections for." },
      },
      required: ["notebookId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const notebookId = typeof input.notebookId === "string" ? input.notebookId : "";
      if (!notebookId) return missingParam("notebookId");

      const response = await graphRequest<GraphCollectionResponse<OnenoteSection>>({
        token: context.token,
        path: `/me/onenote/notebooks/${notebookId}/sections`,
      });

      const sections = response.value;
      if (sections.length === 0) {
        return { content: "No sections found in this notebook." };
      }

      const lines = sections.map(formatSection);
      return { content: `Found ${sections.length} section(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// onenote_pages
// ---------------------------------------------------------------------------

export function onenotePagesTool(): AgentTool {
  return {
    name: "onenote_pages",
    description:
      "List pages within a specific OneNote section. Returns page titles, IDs, and dates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sectionId: { type: "string", description: "The section ID to list pages for." },
      },
      required: ["sectionId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const sectionId = typeof input.sectionId === "string" ? input.sectionId : "";
      if (!sectionId) return missingParam("sectionId");

      const response = await graphRequest<GraphCollectionResponse<OnenotePage>>({
        token: context.token,
        path: `/me/onenote/sections/${sectionId}/pages`,
      });

      const pages = response.value;
      if (pages.length === 0) {
        return { content: "No pages found in this section." };
      }

      const lines = pages.map(formatPage);
      return { content: `Found ${pages.length} page(s):\n${lines.join("\n")}` };
    },
  };
}

// ---------------------------------------------------------------------------
// onenote_read
// ---------------------------------------------------------------------------

export function onenoteReadTool(): AgentTool {
  return {
    name: "onenote_read",
    description:
      "Get the HTML content of a specific OneNote page. Returns the full page content as HTML.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageId: { type: "string", description: "The page ID to read content from." },
      },
      required: ["pageId"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const pageId = typeof input.pageId === "string" ? input.pageId : "";
      if (!pageId) return missingParam("pageId");

      // Direct fetch because the Graph response is HTML, not JSON
      const url = `https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}/content`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${context.token}`,
          Accept: "text/html",
        },
      });

      if (!res.ok) {
        return { content: `Error: Failed to read page (${res.status})`, isError: true };
      }

      const html = await res.text();
      return { content: `# Page Content\n\n${html}` };
    },
  };
}

// ---------------------------------------------------------------------------
// onenote_create
// ---------------------------------------------------------------------------

export function onenoteCreateTool(): AgentTool {
  return {
    name: "onenote_create",
    description:
      "Create a new page in a OneNote section. Provide HTML content for the page body. Optionally provide a title.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sectionId: { type: "string", description: "The section ID to create the page in." },
        htmlContent: { type: "string", description: "HTML content for the page body." },
        title: { type: "string", description: "Optional page title." },
      },
      required: ["sectionId", "htmlContent"],
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const sectionId = typeof input.sectionId === "string" ? input.sectionId : "";
      if (!sectionId) return missingParam("sectionId");

      const htmlContent = typeof input.htmlContent === "string" ? input.htmlContent : "";
      if (!htmlContent) return missingParam("htmlContent");

      const title = typeof input.title === "string" ? input.title : "";

      let body: string;
      if (title) {
        body = `<!DOCTYPE html><html><head><title>${title}</title></head><body>${htmlContent}</body></html>`;
      } else {
        body = htmlContent;
      }

      const result = await graphRequest<OnenotePage>({
        token: context.token,
        path: `/me/onenote/sections/${sectionId}/pages`,
        method: "POST",
        headers: { "Content-Type": "application/xhtml+xml" },
        body,
      });

      const parts: string[] = ["Page created successfully:"];
      parts.push(`  Title: ${result.title}`);
      parts.push(`  Created: ${result.createdDateTime}`);
      if (result.contentUrl) parts.push(`  Content URL: ${result.contentUrl}`);
      parts.push(`  id: ${result.id}`);

      return { content: parts.join("\n") };
    },
  };
}
