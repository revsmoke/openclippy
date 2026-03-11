import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateServiceModule, loadPlugin } from "./loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ServiceModule-shaped plain object */
function validServiceModule() {
  return {
    id: "test-plugin",
    meta: {
      label: "Test Plugin",
      description: "A test plugin",
      requiredScopes: [] as string[],
    },
    capabilities: {
      read: true,
      write: false,
      delete: false,
      search: false,
      subscribe: false,
    },
    tools: () => [],
  };
}

// ---------------------------------------------------------------------------
// validateServiceModule
// ---------------------------------------------------------------------------
describe("validateServiceModule", () => {
  it("valid ServiceModule passes validation", () => {
    expect(validateServiceModule(validServiceModule())).toBe(true);
  });

  it("rejects object with missing id property", () => {
    const mod = validServiceModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (mod as any).id;
    expect(validateServiceModule(mod)).toBe(false);
  });

  it("rejects object with missing tools function", () => {
    const mod = validServiceModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (mod as any).tools;
    expect(validateServiceModule(mod)).toBe(false);
  });

  it("rejects object with missing meta property", () => {
    const mod = validServiceModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (mod as any).meta;
    expect(validateServiceModule(mod)).toBe(false);
  });

  it("rejects object with missing capabilities property", () => {
    const mod = validServiceModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (mod as any).capabilities;
    expect(validateServiceModule(mod)).toBe(false);
  });

  it("rejects non-object input (null, number, string)", () => {
    expect(validateServiceModule(null)).toBe(false);
    expect(validateServiceModule(42)).toBe(false);
    expect(validateServiceModule("hello")).toBe(false);
    expect(validateServiceModule(undefined)).toBe(false);
  });

  it("rejects object where tools is not a function", () => {
    const mod = { ...validServiceModule(), tools: "not-a-function" };
    expect(validateServiceModule(mod)).toBe(false);
  });

  it("accepts object with optional status.probe function", () => {
    const mod = {
      ...validServiceModule(),
      status: { probe: async () => ({ ok: true }) },
    };
    expect(validateServiceModule(mod)).toBe(true);
  });

  it("accepts object with optional promptHints function", () => {
    const mod = {
      ...validServiceModule(),
      promptHints: () => ["hint1"],
    };
    expect(validateServiceModule(mod)).toBe(true);
  });

  it("accepts object with valid subscriptions", () => {
    const mod = {
      ...validServiceModule(),
      subscriptions: {
        resources: ["me/messages"],
        changeTypes: ["created"],
        handle: async () => {},
      },
    };
    expect(validateServiceModule(mod)).toBe(true);
  });

  it("rejects object with invalid subscriptions (missing resources array)", () => {
    const mod = {
      ...validServiceModule(),
      subscriptions: {
        changeTypes: ["created"],
        handle: async () => {},
      },
    };
    expect(validateServiceModule(mod)).toBe(false);
  });

  it("rejects object with invalid subscriptions (missing handle function)", () => {
    const mod = {
      ...validServiceModule(),
      subscriptions: {
        resources: ["me/messages"],
        changeTypes: ["created"],
        handle: "not-a-function",
      },
    };
    expect(validateServiceModule(mod)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadPlugin — real file-system fixtures
// ---------------------------------------------------------------------------
describe("loadPlugin", () => {
  const fixtureRoot = join(tmpdir(), `openclippy-loader-test-${Date.now()}`);
  const validPluginDir = join(fixtureRoot, "valid-plugin");
  const mismatchPluginDir = join(fixtureRoot, "mismatch-plugin");
  const badShapePluginDir = join(fixtureRoot, "bad-shape-plugin");
  const missingFilePluginDir = join(fixtureRoot, "missing-file-plugin");

  beforeAll(async () => {
    // --- valid plugin ---
    await mkdir(validPluginDir, { recursive: true });
    await writeFile(
      join(validPluginDir, "manifest.json"),
      JSON.stringify({
        name: "valid-plugin",
        version: "1.0.0",
        description: "A valid test plugin",
        serviceId: "test-plugin",
        entry: "./index.js",
      }),
    );
    await writeFile(
      join(validPluginDir, "index.js"),
      `export default {
  id: "test-plugin",
  meta: {
    label: "Test Plugin",
    description: "A test plugin",
    requiredScopes: [],
  },
  capabilities: { read: true, write: false, delete: false, search: false, subscribe: false },
  tools: () => [],
};
`,
    );

    // --- id mismatch plugin ---
    await mkdir(mismatchPluginDir, { recursive: true });
    await writeFile(
      join(mismatchPluginDir, "manifest.json"),
      JSON.stringify({
        name: "mismatch-plugin",
        version: "1.0.0",
        description: "ID mismatch plugin",
        serviceId: "expected-id",
        entry: "./index.js",
      }),
    );
    await writeFile(
      join(mismatchPluginDir, "index.js"),
      `export default {
  id: "wrong-id",
  meta: {
    label: "Mismatch Plugin",
    description: "Wrong ID",
    requiredScopes: [],
  },
  capabilities: { read: true, write: false, delete: false, search: false, subscribe: false },
  tools: () => [],
};
`,
    );

    // --- bad shape plugin (missing required fields) ---
    await mkdir(badShapePluginDir, { recursive: true });
    await writeFile(
      join(badShapePluginDir, "manifest.json"),
      JSON.stringify({
        name: "bad-shape-plugin",
        version: "1.0.0",
        description: "Bad shape plugin",
        serviceId: "bad-shape",
        entry: "./index.js",
      }),
    );
    await writeFile(
      join(badShapePluginDir, "index.js"),
      `export default { id: "bad-shape", notAValidModule: true };
`,
    );

    // --- missing file plugin (manifest exists, entry file does not) ---
    await mkdir(missingFilePluginDir, { recursive: true });
    await writeFile(
      join(missingFilePluginDir, "manifest.json"),
      JSON.stringify({
        name: "missing-file-plugin",
        version: "1.0.0",
        description: "Missing entry file",
        serviceId: "missing-entry",
        entry: "./index.js",
      }),
    );
    // Deliberately do NOT create index.js
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("loads valid ESM module and returns PluginLoadResult", async () => {
    const result = await loadPlugin(validPluginDir);

    expect(result.manifest.name).toBe("valid-plugin");
    expect(result.manifest.serviceId).toBe("test-plugin");
    expect(result.path).toBe(validPluginDir);
    expect(result.module.id).toBe("test-plugin");
    expect(typeof result.module.tools).toBe("function");
    expect(result.module.tools()).toEqual([]);
  });

  it("validates id matches manifest serviceId — throws if mismatch", async () => {
    await expect(loadPlugin(mismatchPluginDir)).rejects.toThrow(/id.*mismatch|does not match/i);
  });

  it("throws when module fails shape validation", async () => {
    await expect(loadPlugin(badShapePluginDir)).rejects.toThrow(/valid ServiceModule|shape|validation/i);
  });

  it("throws when import() fails (missing file)", async () => {
    await expect(loadPlugin(missingFilePluginDir)).rejects.toThrow();
  });

  it("throws when entry path escapes plugin directory (path traversal)", async () => {
    const traversalPluginDir = join(fixtureRoot, "traversal-plugin");
    await mkdir(traversalPluginDir, { recursive: true });
    await writeFile(
      join(traversalPluginDir, "manifest.json"),
      JSON.stringify({
        name: "traversal-plugin",
        version: "1.0.0",
        description: "Path traversal attempt",
        serviceId: "traversal",
        entry: "../../escape.js",
      }),
    );
    // manifest validation should catch ".." in entry path
    await expect(loadPlugin(traversalPluginDir)).rejects.toThrow(/traversal|path|entry/i);
  });
});
