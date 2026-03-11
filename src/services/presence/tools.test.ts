import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Presence } from "./types.js";
import {
  presenceReadTool,
  presenceSetTool,
  presenceClearTool,
} from "./tools.js";
import { createToolContext } from "../../test-utils/graph-mock.js";

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

const ctx = createToolContext();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const availablePresence: Presence = {
  id: "user-id-1",
  availability: "Available",
  activity: "Available",
};

const busyPresence: Presence = {
  id: "user-id-1",
  availability: "Busy",
  activity: "InAMeeting",
};

const dndPresence: Presence = {
  id: "user-id-1",
  availability: "DoNotDisturb",
  activity: "Presenting",
};

const awayPresence: Presence = {
  id: "user-id-1",
  availability: "Away",
  activity: "Away",
};

const brbPresence: Presence = {
  id: "user-id-1",
  availability: "BeRightBack",
  activity: "BeRightBack",
};

const offlinePresence: Presence = {
  id: "user-id-1",
  availability: "Offline",
  activity: "Offline",
};

const presenceWithStatus: Presence = {
  id: "user-id-1",
  availability: "Busy",
  activity: "InACall",
  statusMessage: {
    message: {
      content: "On a customer call",
      contentType: "text",
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGraphRequest.mockReset();
});

describe("presence_read", () => {
  const tool = presenceReadTool();

  it("has correct name and description", () => {
    expect(tool.name).toBe("presence_read");
    expect(tool.description).toBeTruthy();
  });

  it("returns formatted presence with green indicator for Available", async () => {
    mockGraphRequest.mockResolvedValue(availablePresence);

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("\u{1F7E2}"); // green circle
    expect(result.content).toContain("Available");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        path: "/me/presence",
      }),
    );
  });

  it("returns red indicator for Busy", async () => {
    mockGraphRequest.mockResolvedValue(busyPresence);

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("\u{1F534}"); // red circle
    expect(result.content).toContain("Busy");
    expect(result.content).toContain("InAMeeting");
  });

  it("returns red indicator for DoNotDisturb", async () => {
    mockGraphRequest.mockResolvedValue(dndPresence);

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("\u{1F534}"); // red circle
    expect(result.content).toContain("DoNotDisturb");
    expect(result.content).toContain("Presenting");
  });

  it("returns yellow indicator for Away", async () => {
    mockGraphRequest.mockResolvedValue(awayPresence);

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("\u{1F7E1}"); // yellow circle
    expect(result.content).toContain("Away");
  });

  it("returns yellow indicator for BeRightBack", async () => {
    mockGraphRequest.mockResolvedValue(brbPresence);

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("\u{1F7E1}"); // yellow circle
    expect(result.content).toContain("BeRightBack");
  });

  it("returns black indicator for Offline", async () => {
    mockGraphRequest.mockResolvedValue(offlinePresence);

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("\u26AB"); // black circle
    expect(result.content).toContain("Offline");
  });

  it("includes status message when present", async () => {
    mockGraphRequest.mockResolvedValue(presenceWithStatus);

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("On a customer call");
  });

  it("calls Graph API with correct path", async () => {
    mockGraphRequest.mockResolvedValue(availablePresence);

    await tool.execute({}, ctx);

    expect(mockGraphRequest).toHaveBeenCalledWith({
      token: "test-token",
      path: "/me/presence",
    });
  });
});

describe("presence_set", () => {
  const tool = presenceSetTool();

  it("has correct name and description", () => {
    expect(tool.name).toBe("presence_set");
    expect(tool.description).toBeTruthy();
  });

  it("sets user preferred presence with all fields", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        availability: "DoNotDisturb",
        activity: "DoNotDisturb",
        expirationDuration: "PT1H",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("DoNotDisturb");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        method: "POST",
        path: "/me/presence/setUserPreferredPresence",
        body: {
          availability: "DoNotDisturb",
          activity: "DoNotDisturb",
          expirationDuration: "PT1H",
        },
      }),
    );
  });

  it("returns error when availability is missing", async () => {
    const result = await tool.execute(
      { activity: "DoNotDisturb", expirationDuration: "PT1H" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("availability");
  });

  it("returns error when activity is missing", async () => {
    const result = await tool.execute(
      { availability: "DoNotDisturb", expirationDuration: "PT1H" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("activity");
  });

  it("returns error when expirationDuration is missing", async () => {
    const result = await tool.execute(
      { availability: "DoNotDisturb", activity: "DoNotDisturb" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("expirationDuration");
  });

  it("includes emoji indicator in confirmation", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        availability: "Available",
        activity: "Available",
        expirationDuration: "PT2H",
      },
      ctx,
    );

    expect(result.content).toContain("\u{1F7E2}"); // green circle
  });

  it("includes expiration duration in confirmation", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute(
      {
        availability: "Busy",
        activity: "Busy",
        expirationDuration: "PT30M",
      },
      ctx,
    );

    expect(result.content).toContain("PT30M");
  });
});

describe("presence_clear", () => {
  const tool = presenceClearTool();

  it("has correct name and description", () => {
    expect(tool.name).toBe("presence_clear");
    expect(tool.description).toBeTruthy();
  });

  it("clears user preferred presence", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({}, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("cleared");

    expect(mockGraphRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        method: "POST",
        path: "/me/presence/clearUserPreferredPresence",
      }),
    );
  });

  it("confirms automatic presence is restored", async () => {
    mockGraphRequest.mockResolvedValue(undefined);

    const result = await tool.execute({}, ctx);

    expect(result.content).toContain("automatic");
  });
});

describe("presenceModule integration", () => {
  it("exports 3 tools with correct names", async () => {
    const { presenceModule } = await import("./module.js");
    const tools = presenceModule.tools();

    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "presence_read",
      "presence_set",
      "presence_clear",
    ]);
  });

  it("has correct module metadata", async () => {
    const { presenceModule } = await import("./module.js");

    expect(presenceModule.id).toBe("presence");
    expect(presenceModule.meta.requiredScopes).toContain("Presence.Read");
    expect(presenceModule.meta.optionalScopes).toContain("Presence.ReadWrite");
    expect(presenceModule.capabilities.read).toBe(true);
    expect(presenceModule.capabilities.write).toBe(true);
    expect(presenceModule.capabilities.delete).toBe(false);
    expect(presenceModule.capabilities.search).toBe(false);
  });

  it("provides prompt hints", async () => {
    const { presenceModule } = await import("./module.js");

    const hints = presenceModule.promptHints?.();
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);
  });
});
