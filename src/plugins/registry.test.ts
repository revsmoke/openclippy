import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceRegistry } from "../services/registry.js";
import { ScopeManager } from "../auth/scope-manager.js";
import { PluginRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Helpers — create temp plugin fixtures on disk
// ---------------------------------------------------------------------------

const fixtureRoot = join(tmpdir(), `openclippy-registry-test-${Date.now()}`);

/** Write a valid plugin (manifest + ESM entry) to a temp dir */
async function createValidPlugin(
  parentDir: string,
  name: string,
  serviceId: string,
  scopes?: { required?: string[]; optional?: string[] },
): Promise<string> {
  const pluginDir = join(parentDir, name);
  await mkdir(pluginDir, { recursive: true });

  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      description: `${name} plugin`,
      serviceId,
      entry: "./index.js",
      ...(scopes ? { scopes } : {}),
    }),
  );

  await writeFile(
    join(pluginDir, "index.js"),
    `export default {
  id: ${JSON.stringify(serviceId)},
  meta: {
    label: ${JSON.stringify(name)},
    description: "A test plugin",
    requiredScopes: ${JSON.stringify(scopes?.required ?? [])},
  },
  capabilities: { read: true, write: false, delete: false, search: false, subscribe: false },
  tools: () => [{ name: "${serviceId}_tool", description: "A tool", inputSchema: { type: "object", properties: {} }, execute: async () => ({ content: "ok" }) }],
};
`,
  );

  return pluginDir;
}

/** Write a plugin with an invalid manifest (missing required field) */
async function createInvalidManifestPlugin(
  parentDir: string,
  name: string,
): Promise<string> {
  const pluginDir = join(parentDir, name);
  await mkdir(pluginDir, { recursive: true });

  // Missing serviceId — invalid manifest
  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      description: "Invalid plugin",
      entry: "./index.js",
      // serviceId intentionally omitted
    }),
  );

  await writeFile(
    join(pluginDir, "index.js"),
    `export default { id: "invalid" };`,
  );

  return pluginDir;
}

/** Write a plugin with a valid manifest but broken module (bad shape) */
async function createBadModulePlugin(
  parentDir: string,
  name: string,
  serviceId: string,
): Promise<string> {
  const pluginDir = join(parentDir, name);
  await mkdir(pluginDir, { recursive: true });

  await writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      description: `${name} plugin`,
      serviceId,
      entry: "./index.js",
    }),
  );

  // Missing required fields — will fail validateServiceModule
  await writeFile(
    join(pluginDir, "index.js"),
    `export default { id: ${JSON.stringify(serviceId)}, notAModule: true };`,
  );

  return pluginDir;
}

// ---------------------------------------------------------------------------
// Fixture dirs
// ---------------------------------------------------------------------------
const singlePluginDir = join(fixtureRoot, "single");
const invalidManifestDir = join(fixtureRoot, "invalid-manifest");
const badModuleDir = join(fixtureRoot, "bad-module");
const builtinCollisionDir = join(fixtureRoot, "builtin-collision");
const pluginCollisionDir = join(fixtureRoot, "plugin-collision");
const scopesDir = join(fixtureRoot, "scopes");
const multiErrorDir = join(fixtureRoot, "multi-error");
const emptyDir = join(fixtureRoot, "empty");
const multiPluginDir = join(fixtureRoot, "multi-plugin");

beforeAll(async () => {
  // --- single valid plugin ---
  await createValidPlugin(singlePluginDir, "alpha-plugin", "alpha");

  // --- invalid manifest dir ---
  await createInvalidManifestPlugin(invalidManifestDir, "broken-manifest");

  // --- bad module dir ---
  await createBadModulePlugin(badModuleDir, "bad-shape", "bad-shape");

  // --- builtin collision dir (uses "mail" which is a builtin id) ---
  await createValidPlugin(builtinCollisionDir, "mail-imposter", "mail");

  // --- plugin-plugin collision dir (two plugins with same serviceId) ---
  await createValidPlugin(pluginCollisionDir, "dup-plugin-1", "duplicate-svc");
  await createValidPlugin(pluginCollisionDir, "dup-plugin-2", "duplicate-svc");

  // --- scopes dir (plugin with custom scopes) ---
  await createValidPlugin(scopesDir, "scoped-plugin", "scoped-svc", {
    required: ["Custom.Read"],
    optional: ["Custom.Write"],
  });

  // --- multi-error dir (one invalid, one bad shape) ---
  await createInvalidManifestPlugin(multiErrorDir, "err1");
  await createBadModulePlugin(multiErrorDir, "err2", "err2");

  // --- empty dir ---
  await mkdir(emptyDir, { recursive: true });

  // --- multi-plugin dir (two valid plugins for getLoadedPlugins test) ---
  await createValidPlugin(multiPluginDir, "plugin-a", "svc-a");
  await createValidPlugin(multiPluginDir, "plugin-b", "svc-b");
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PluginRegistry tests
// ---------------------------------------------------------------------------
describe("PluginRegistry", () => {
  let serviceRegistry: ServiceRegistry;
  let scopeManager: ScopeManager;
  let pluginRegistry: PluginRegistry;

  beforeEach(() => {
    serviceRegistry = new ServiceRegistry();
    scopeManager = new ScopeManager();
    pluginRegistry = new PluginRegistry(serviceRegistry, scopeManager);
  });

  // 1. loadAll discovers and loads plugins from directory
  it("loadAll discovers and loads plugins from directory", async () => {
    const result = await pluginRegistry.loadAll({
      pluginsDir: singlePluginDir,
    });

    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0].manifest.serviceId).toBe("alpha");
    expect(result.loaded[0].module.id).toBe("alpha");
    expect(result.errors).toHaveLength(0);
  });

  // 2. loadAll skips invalid manifests with warning (collects error)
  it("loadAll skips invalid manifests with warning", async () => {
    const result = await pluginRegistry.loadAll({
      pluginsDir: invalidManifestDir,
    });

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/manifest|serviceId|invalid/i);
  });

  // 3. loadAll skips failed loads with warning (collects error)
  it("loadAll skips failed loads with warning", async () => {
    const result = await pluginRegistry.loadAll({
      pluginsDir: badModuleDir,
    });

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/ServiceModule|shape|valid/i);
  });

  // 4. loadAll rejects duplicate serviceId (builtin collision)
  it("loadAll rejects duplicate serviceId — builtin collision", async () => {
    // Pre-register "mail" as a builtin service
    serviceRegistry.register({
      id: "mail",
      meta: {
        label: "Mail",
        description: "Built-in mail service",
        requiredScopes: ["Mail.Read"],
      },
      capabilities: {
        read: true,
        write: false,
        delete: false,
        search: false,
        subscribe: false,
      },
      tools: () => [],
    });

    const result = await pluginRegistry.loadAll({
      pluginsDir: builtinCollisionDir,
    });

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/collision|duplicate|already.*registered/i);
  });

  // 5. loadAll rejects duplicate serviceId (plugin-plugin collision)
  it("loadAll rejects duplicate serviceId — plugin-plugin collision", async () => {
    const result = await pluginRegistry.loadAll({
      pluginsDir: pluginCollisionDir,
    });

    // One succeeds, the second is rejected
    expect(result.loaded).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/collision|duplicate|already.*registered/i);
  });

  // 6. Loaded plugins register into ServiceRegistry
  it("loaded plugins register into ServiceRegistry", async () => {
    await pluginRegistry.loadAll({ pluginsDir: singlePluginDir });

    const registered = serviceRegistry.get("alpha");
    expect(registered).toBeDefined();
    expect(registered!.id).toBe("alpha");
    expect(typeof registered!.tools).toBe("function");
  });

  // 7. Loaded plugins register scopes into ScopeManager
  it("loaded plugins register scopes into ScopeManager", async () => {
    await pluginRegistry.loadAll({ pluginsDir: scopesDir });

    const scopes = scopeManager.computeRequiredScopes(["scoped-svc"]);
    expect(scopes).toContain("Custom.Read");
    expect(scopes).toContain("Custom.Write");
  });

  // 8. getLoadErrors returns all errors encountered
  it("getLoadErrors returns all errors encountered", async () => {
    await pluginRegistry.loadAll({ pluginsDir: multiErrorDir });

    const errors = pluginRegistry.getLoadErrors();
    expect(errors).toHaveLength(2);
    // Verify they have pluginPath and error properties
    for (const err of errors) {
      expect(err.pluginPath).toBeDefined();
      expect(typeof err.error).toBe("string");
    }
  });

  // 9. Empty plugins directory → no errors, no plugins loaded
  it("empty plugins directory produces no errors and no plugins", async () => {
    const result = await pluginRegistry.loadAll({ pluginsDir: emptyDir });

    expect(result.loaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // 10. getLoadedPlugins returns loaded plugin results
  it("getLoadedPlugins returns loaded plugin results", async () => {
    await pluginRegistry.loadAll({ pluginsDir: multiPluginDir });

    const loaded = pluginRegistry.getLoadedPlugins();
    expect(loaded).toHaveLength(2);

    const ids = loaded.map((p) => p.manifest.serviceId).sort();
    expect(ids).toEqual(["svc-a", "svc-b"]);
  });
});
