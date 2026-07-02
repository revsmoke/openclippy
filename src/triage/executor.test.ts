import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../graph/client.js", () => ({
  graphRequest: vi.fn(),
  graphPaginate: vi.fn(),
  graphBatch: vi.fn(),
  GraphApiError: class GraphApiError extends Error {
    constructor(
      public readonly path: string,
      public readonly status: number,
      public readonly body: string,
      public readonly code?: string,
    ) {
      super(`Graph API ${path} failed (${status}): ${body.slice(0, 200)}`);
      this.name = "GraphApiError";
    }
    get isThrottled() {
      return this.status === 429;
    }
    get isNotFound() {
      return this.status === 404;
    }
    get isUnauthorized() {
      return this.status === 401;
    }
    get isForbidden() {
      return this.status === 403;
    }
  },
}));

import { graphRequest, GraphApiError } from "../graph/client.js";
import { executeAction, FolderResolver } from "./executor.js";

const mockGraphRequest = vi.mocked(graphRequest);
const TOKEN = "test-token";

function folders(opts?: { createMissing?: boolean }): FolderResolver {
  return new FolderResolver(TOKEN, opts);
}

describe("FolderResolver", () => {
  beforeEach(() => {
    mockGraphRequest.mockReset();
  });

  it("passes well-known folder names straight through", async () => {
    expect(await folders().resolve("Archive")).toBe("archive");
    expect(await folders().resolve("deleteditems")).toBe("deleteditems");
    expect(await folders().resolve("Deleted Items")).toBe("deleteditems");
    expect(mockGraphRequest).not.toHaveBeenCalled();
  });

  it("walks nested paths segment by segment, case-insensitively", async () => {
    mockGraphRequest
      .mockResolvedValueOnce({
        value: [{ id: "id-vendors", displayName: "Vendors" }],
      })
      .mockResolvedValueOnce({
        value: [{ id: "id-invoices", displayName: "Invoices" }],
      });

    const resolver = folders();
    const id = await resolver.resolve("vendors/INVOICES");
    expect(id).toBe("id-invoices");

    expect(mockGraphRequest.mock.calls[0][0].path).toContain("/me/mailFolders?");
    expect(mockGraphRequest.mock.calls[1][0].path).toContain(
      "/me/mailFolders/id-vendors/childFolders",
    );

    // Second resolve hits the cache
    mockGraphRequest.mockClear();
    expect(await resolver.resolve("vendors/INVOICES")).toBe("id-invoices");
    expect(mockGraphRequest).not.toHaveBeenCalled();
  });

  it("errors on missing folders without createMissing", async () => {
    mockGraphRequest.mockResolvedValueOnce({ value: [] });
    await expect(folders().resolve("Nope")).rejects.toThrow(
      'Mail folder "Nope" not found',
    );
  });

  it("creates missing segments with createMissing", async () => {
    mockGraphRequest
      .mockResolvedValueOnce({ value: [] }) // list top-level: no "Vendors"
      .mockResolvedValueOnce({ id: "new-vendors", displayName: "Vendors" }) // create
      .mockResolvedValueOnce({ value: [] }) // list children: no "Invoices"
      .mockResolvedValueOnce({ id: "new-invoices", displayName: "Invoices" }); // create

    const id = await folders({ createMissing: true }).resolve("Vendors/Invoices");
    expect(id).toBe("new-invoices");

    const createCall = mockGraphRequest.mock.calls[1][0];
    expect(createCall.method).toBe("POST");
    expect(createCall.path).toBe("/me/mailFolders");
    expect(createCall.body).toEqual({ displayName: "Vendors" });

    const nestedCreate = mockGraphRequest.mock.calls[3][0];
    expect(nestedCreate.path).toBe("/me/mailFolders/new-vendors/childFolders");
  });
});

describe("executeAction", () => {
  beforeEach(() => {
    mockGraphRequest.mockReset();
  });

  it("moves using the cached folder id when it still works", async () => {
    mockGraphRequest.mockResolvedValueOnce({ id: "moved-1" });

    const result = await executeAction({
      token: TOKEN,
      messageId: "msg-1",
      action: { type: "move", folder: "Vendors/Invoices" },
      folders: folders(),
      cachedFolderId: "cached-id",
    });

    expect(result.ok).toBe(true);
    const call = mockGraphRequest.mock.calls[0][0];
    expect(call.path).toBe("/me/messages/msg-1/move");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ destinationId: "cached-id" });
  });

  it("re-resolves by name when the cached folder id is stale (404)", async () => {
    mockGraphRequest
      .mockRejectedValueOnce(
        new GraphApiError("/me/messages/msg-1/move", 404, "not found"),
      )
      .mockResolvedValueOnce({
        value: [{ id: "fresh-id", displayName: "Receipts" }],
      })
      .mockResolvedValueOnce({ id: "moved-1" });

    let resolvedId: string | undefined;
    const result = await executeAction({
      token: TOKEN,
      messageId: "msg-1",
      action: { type: "move", folder: "Receipts" },
      folders: folders(),
      cachedFolderId: "stale-id",
      onFolderResolved: (id) => {
        resolvedId = id;
      },
    });

    expect(result.ok).toBe(true);
    expect(resolvedId).toBe("fresh-id");
    const retry = mockGraphRequest.mock.calls[2][0];
    expect(retry.body).toEqual({ destinationId: "fresh-id" });
  });

  it("forwards to a group mailbox SMTP address with comment and alsoFlag", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await executeAction({
      token: TOKEN,
      messageId: "msg-2",
      action: {
        type: "forward",
        to: "support-team@archinet.net",
        comment: "Routed by triage",
        alsoFlag: true,
      },
      folders: folders(),
    });

    expect(result.ok).toBe(true);
    const fwd = mockGraphRequest.mock.calls[0][0];
    expect(fwd.path).toBe("/me/messages/msg-2/forward");
    expect(fwd.method).toBe("POST");
    expect(fwd.body).toEqual({
      toRecipients: [{ emailAddress: { address: "support-team@archinet.net" } }],
      comment: "Routed by triage",
    });

    const flag = mockGraphRequest.mock.calls[1][0];
    expect(flag.method).toBe("PATCH");
    expect(flag.body).toEqual({ flag: { flagStatus: "flagged" } });
  });

  it("flags via PATCH", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    await executeAction({
      token: TOKEN,
      messageId: "msg-3",
      action: { type: "flag" },
      folders: folders(),
    });
    const call = mockGraphRequest.mock.calls[0][0];
    expect(call.path).toBe("/me/messages/msg-3");
    expect(call.body).toEqual({ flag: { flagStatus: "flagged" } });
  });

  it("prioritizes via PATCH importance", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    await executeAction({
      token: TOKEN,
      messageId: "msg-4",
      action: { type: "prioritize", importance: "high" },
      folders: folders(),
    });
    expect(mockGraphRequest.mock.calls[0][0].body).toEqual({
      importance: "high",
    });
  });

  it("categorizes via PATCH categories", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    await executeAction({
      token: TOKEN,
      messageId: "msg-5",
      action: { type: "categorize", categories: ["Finance", "Vendors"] },
      folders: folders(),
    });
    expect(mockGraphRequest.mock.calls[0][0].body).toEqual({
      categories: ["Finance", "Vendors"],
    });
  });

  it("sends an approved reply draft via /reply", async () => {
    mockGraphRequest.mockResolvedValue(undefined);
    const result = await executeAction({
      token: TOKEN,
      messageId: "msg-6",
      action: {
        type: "reply_draft",
        guidance: "Acknowledge receipt",
        draft: "Thanks — I'll review this today.",
      },
      folders: folders(),
    });
    expect(result.ok).toBe(true);
    const call = mockGraphRequest.mock.calls[0][0];
    expect(call.path).toBe("/me/messages/msg-6/reply");
    expect(call.body).toEqual({ comment: "Thanks — I'll review this today." });
  });

  it("returns ok for none without any Graph call", async () => {
    const result = await executeAction({
      token: TOKEN,
      messageId: "msg-7",
      action: { type: "none" },
      folders: folders(),
    });
    expect(result.ok).toBe(true);
    expect(mockGraphRequest).not.toHaveBeenCalled();
  });

  it("captures Graph failures as ok:false with the error message", async () => {
    mockGraphRequest.mockRejectedValueOnce(
      new GraphApiError("/me/messages/msg-8", 403, "denied", "ErrorAccessDenied"),
    );
    const result = await executeAction({
      token: TOKEN,
      messageId: "msg-8",
      action: { type: "flag" },
      folders: folders(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
  });
});
