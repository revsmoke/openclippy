import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateManifest, readManifest } from "./manifest.js";
import type { PluginManifest } from "./types.js";

/** Helper: a valid manifest object */
function validManifest(): PluginManifest {
  return {
    name: "my-plugin",
    version: "1.0.0",
    description: "A test plugin",
    serviceId: "custom-service",
    entry: "./index.js",
  };
}

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------
describe("validateManifest", () => {
  it("returns valid for a correct manifest", () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.name).toBe("my-plugin");
      expect(result.manifest.version).toBe("1.0.0");
      expect(result.manifest.serviceId).toBe("custom-service");
      expect(result.manifest.entry).toBe("./index.js");
    }
  });

  it("returns error when name is missing", () => {
    const data = validManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (data as any).name;
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/name/i);
    }
  });

  it("returns error when serviceId is missing", () => {
    const data = validManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (data as any).serviceId;
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/serviceId/i);
    }
  });

  it("returns error when entry is missing", () => {
    const data = validManifest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (data as any).entry;
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/entry/i);
    }
  });

  it("returns error when serviceId is empty string", () => {
    const data = { ...validManifest(), serviceId: "" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/serviceId/i);
    }
  });

  it("returns error when version is not a string", () => {
    const data = { ...validManifest(), version: 123 };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/version/i);
    }
  });

  it("validates optional scopes section with required and optional arrays", () => {
    const data = {
      ...validManifest(),
      scopes: {
        required: ["Mail.Read"],
        optional: ["Mail.ReadWrite"],
      },
    };
    const result = validateManifest(data);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.scopes?.required).toEqual(["Mail.Read"]);
      expect(result.manifest.scopes?.optional).toEqual(["Mail.ReadWrite"]);
    }
  });

  it("ignores extra fields for forward compatibility", () => {
    const data = {
      ...validManifest(),
      author: "Test Author",
      homepage: "https://example.com",
      futureField: 42,
    };
    const result = validateManifest(data);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Extra fields should not appear on the typed manifest
      expect(result.manifest.name).toBe("my-plugin");
      expect((result.manifest as Record<string, unknown>)["author"]).toBeUndefined();
    }
  });

  it("returns error when data is not an object", () => {
    const result = validateManifest("not-an-object");
    expect(result.valid).toBe(false);
  });

  it("returns error when data is null", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
  });

  it("returns error when name is empty string", () => {
    const data = { ...validManifest(), name: "" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/name/i);
    }
  });

  it("returns error when entry is empty string", () => {
    const data = { ...validManifest(), entry: "" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/entry/i);
    }
  });

  it("returns error when entry is not a .js or .mjs file", () => {
    const data = { ...validManifest(), entry: "index.ts" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/\.js.*\.mjs|entry/i);
    }
  });

  it("accepts .mjs entry files", () => {
    const data = { ...validManifest(), entry: "./index.mjs" };
    const result = validateManifest(data);
    expect(result.valid).toBe(true);
  });

  it("returns error when entry contains path traversal (..)", () => {
    const data = { ...validManifest(), entry: "../../evil.js" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/traversal|path/i);
    }
  });

  it("returns error when entry is an absolute path", () => {
    const data = { ...validManifest(), entry: "/etc/evil.js" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/traversal|absolute|path/i);
    }
  });

  it("returns error when scopes.required is not an array of strings", () => {
    const data = {
      ...validManifest(),
      scopes: { required: [123] },
    };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/scopes/i);
    }
  });
});

// ---------------------------------------------------------------------------
// readManifest
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("readManifest", () => {
  let mockReadFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fs = await import("node:fs/promises");
    mockReadFile = fs.readFile as ReturnType<typeof vi.fn>;
  });

  it("reads and validates a valid manifest.json", async () => {
    const manifest = validManifest();
    mockReadFile.mockResolvedValue(JSON.stringify(manifest));

    const result = await readManifest("/plugins/my-plugin");
    expect(result.name).toBe("my-plugin");
    expect(result.serviceId).toBe("custom-service");
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining("manifest.json"),
      "utf-8",
    );
  });

  it("throws when manifest.json does not exist", async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(readManifest("/plugins/missing")).rejects.toThrow(/manifest\.json/i);
  });

  it("throws when manifest.json contains invalid JSON", async () => {
    mockReadFile.mockResolvedValue("{ invalid json }");

    await expect(readManifest("/plugins/bad-json")).rejects.toThrow();
  });

  it("throws when manifest.json fails validation", async () => {
    const bad = { version: "1.0.0" }; // missing required fields
    mockReadFile.mockResolvedValue(JSON.stringify(bad));

    await expect(readManifest("/plugins/bad-manifest")).rejects.toThrow();
  });
});
